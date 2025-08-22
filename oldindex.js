const express = require("express");
const app = express();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const serverless = require("serverless-http");

app.use(express.json());
app.use(cookieParser());
const allowedOrigins = [
  "http://localhost:5173", // for local dev
  "https://wondrous-kulfi-1da8f4.netlify.app",
  "https://eventa-aura.vercel.app",
  // ✅ your deployed frontend
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);
// const SECRET = process.env.JWT_SECRET;

// console.log(SECRET)
const crypto = require("crypto");

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

require("dotenv").config();

const port = 5000;

// console.log(process.env.MONGODB_USER)
// console.log(process.env.JWT_SECRET)
const hashPassword = (password) => {
  return crypto.createHash("sha256").update(password).digest("hex");
};

const uri = `mongodb+srv://${process.env.MONGODB_USER}:${process.env.MONGODB_PASS}@cluster0.bter72s.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
// console.log(uri);
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const db = client.db("eventAuraDB");
    const usersCollection = db.collection("users");
    const eventsCollection = db.collection("events");

    const authenticate = (req, res, next) => {
      const token = req.cookies.token;
      if (!token) return res.sendStatus(401);

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
      } catch {
        return res.sendStatus(403);
      }
    };
    // REGISTER
    app.post("/register", async (req, res) => {
      const { name, email, password, photoURL } = req.body;

      const existing = await usersCollection.findOne({ email });
      if (existing)
        return res.status(409).send({ message: "Email already in use" });

      const hashed = hashPassword(password);

      const result = await usersCollection.insertOne({
        name,
        email,
        password: hashed,
        photoURL,
      });

      res.send({ success: true, userId: result.insertedId });
    });

    // Login route
    app.post("/login", async (req, res) => {
      const { email, password } = req.body;

      const user = await usersCollection.findOne({ email });
      const hashed = hashPassword(password);

      if (!user || user.password !== hashed) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const token = jwt.sign(
        { id: user._id, name: user.name },
        process.env.JWT_SECRET,
        {
          expiresIn: "7d",
        }
      );

      // ✅ SET COOKIE HERE
      res.cookie("token", token, {
        httpOnly: true,
        secure: true, // ✅ needed on Netlify/Vercel (HTTPS only)
        sameSite: "None", // ✅ for cross-origin
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      // ✅ Send user data in JSON (but token is stored in cookie)
      res.json({ user: { name: user.name, photoURL: user.photoURL } });
    });

    app.post("/logout", (req, res) => {
      res.clearCookie("token", {
        httpOnly: true,
        secure: true,
        sameSite: "None",
      });

      res.status(200).json({ message: "Logged out successfully" });
    });

    app.get("/me", (req, res) => {
      console.log("Token from cookie:", req.cookies.token);

      const token = req.cookies.token;
      if (!token) return res.status(401).json({ message: "No token" });

      try {
        const user = jwt.verify(token, process.env.JWT_SECRET);
        res.json(user);
      } catch (err) {
        console.error("JWT Error:", err);
        return res.status(401).json({ message: "Invalid token" });
      }
    });

    // ✅ Moved outside of any other route
    const {
      startOfWeek,
      endOfWeek,
      startOfMonth,
      endOfMonth,
      subWeeks,
      subMonths,
    } = require("date-fns");

    app.get("/events", authenticate, async (req, res) => {
      try {
        const { search, filter } = req.query;
        let query = {};

        // 🔍 Search by title
        if (search) {
          query.title = { $regex: search, $options: "i" };
        }

        // 🗓️ Date filter
        const now = new Date();
        let startDate, endDate;

        switch (filter) {
          case "today":
            startDate = new Date();
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date();
            endDate.setHours(23, 59, 59, 999);
            query.dateTime = { $gte: startDate, $lte: endDate };
            break;
          case "currentWeek":
            startDate = startOfWeek(now);
            endDate = endOfWeek(now);
            query.dateTime = { $gte: startDate, $lte: endDate };
            break;
          case "lastWeek":
            startDate = startOfWeek(subWeeks(now, 1));
            endDate = endOfWeek(subWeeks(now, 1));
            query.dateTime = { $gte: startDate, $lte: endDate };
            break;
          case "currentMonth":
            startDate = startOfMonth(now);
            endDate = endOfMonth(now);
            query.dateTime = { $gte: startDate, $lte: endDate };
            break;
          case "lastMonth":
            startDate = startOfMonth(subMonths(now, 1));
            endDate = endOfMonth(subMonths(now, 1));
            query.dateTime = { $gte: startDate, $lte: endDate };
            break;
        }

        const userId = req.user.id;

        const events = await eventsCollection
          .find(query)
          .sort({ dateTime: -1 })
          .toArray();

        // Add joined: true/false to each event
        const eventsWithJoinStatus = events.map((event) => {
          const joined = event.attendees?.includes(userId);
          return { ...event, joined };
        });

        res.json(eventsWithJoinStatus);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch events" });
      }
    });

    // ✅ Now this route can stay as-is
    app.post("/add-events", authenticate, async (req, res) => {
      try {
        const { title, dateTime, location, description, attendeeCount } =
          req.body;

        const newEvent = {
          title,
          name: req.user.name,
          dateTime: new Date(req.body.dateTime),
          location,
          description,
          attendeeCount: attendeeCount || 0,
          attendees: [],
        };

        const result = await eventsCollection.insertOne(newEvent);
        res.status(201).json({
          message: "Event added successfully",
          eventId: result.insertedId,
        });
      } catch (error) {
        res.status(500).json({ message: "Server error", error });
      }
    });

    // ✅ Join event route
    app.post("/events/join/:id", authenticate, async (req, res) => {
      try {
        const eventId = req.params.id;
        const userId = req.user.id;

        // Check if user has already joined
        const alreadyJoined = await eventsCollection.findOne({
          _id: new ObjectId(eventId),
          attendees: userId,
        });

        if (alreadyJoined) {
          return res
            .status(400)
            .json({ message: "You already joined this event." });
        }

        const result = await eventsCollection.updateOne(
          { _id: new ObjectId(eventId) },
          {
            $inc: { attendeeCount: 1 },
            $addToSet: { attendees: userId }, // Prevent duplicates
          }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).json({ message: "Event not found." });
        }

        res.json({ message: "Successfully joined event" });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to join event" });
      }
    });

    app.get("/check-auth", (req, res) => {
      const token = req.cookies.token;

      if (!token) {
        return res.status(401).json({ message: "Not logged in" });
      }

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        res.json({ user: decoded }); // or just res.sendStatus(200)
      } catch (err) {
        return res.status(401).json({ message: "Invalid token" });
      }
    });

    // Get events posted by the logged-in user
    app.get("/my-events", authenticate, async (req, res) => {
      try {
        const myEvents = await eventsCollection
          .find({ name: req.user.name }) // or match userId if stored
          .sort({ dateTime: -1 })
          .toArray();
        res.json(myEvents);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch your events" });
      }
    });

    // Update an event
    app.put("/events/:id", authenticate, async (req, res) => {
      const { id } = req.params;
      const { title, dateTime, location, description, attendeeCount } =
        req.body;
      try {
        const result = await eventsCollection.updateOne(
          { _id: new ObjectId(id), name: req.user.name },
          {
            $set: {
              title,
              dateTime: new Date(dateTime),
              location,
              description,
              attendeeCount, // ← now accepting updates
            },
          }
        );

        if (result.modifiedCount === 0) {
          return res
            .status(404)
            .json({ message: "Event not found or not authorized" });
        }

        res.json({ message: "Event updated successfully" });
      } catch (error) {
        res.status(500).json({ message: "Failed to update event" });
      }
    });

    // Delete an event
    app.delete("/events/:id", authenticate, async (req, res) => {
      const { id } = req.params;
      try {
        const result = await eventsCollection.deleteOne({
          _id: new ObjectId(id),
          name: req.user.name,
        });

        if (result.deletedCount === 0) {
          return res
            .status(404)
            .json({ message: "Event not found or not authorized" });
        }

        res.json({ message: "Event deleted successfully" });
      } catch (error) {
        res.status(500).json({ message: "Failed to delete event" });
      }
    });

    // Get 5 upcoming events, sorted by date ascending
    app.get("/featured-upcoming-events", async (req, res) => {
      try {
        const now = new Date();
        const events = await eventsCollection
          .find({ dateTime: { $gte: now } })
          .sort({ dateTime: 1 }) // Earliest first
          .limit(5)
          .toArray();

        res.json(events);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch upcoming events" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Event Aura is running");
});

// Add this export so Vercel can invoke your app as a serverless function
// module.exports = app;
// module.exports.handler = serverless(app);

app.listen(port, () => {
  console.log(`Event Aura are sitting on port ${port}`);
});
