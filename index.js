const express = require("express");
const app = express();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");

app.use(express.json());
app.use(cookieParser());
app.use(cors({
  origin: "http://localhost:5173",  // your frontend's origin
  credentials: true                // allow credentials (cookies)
}));
const SECRET = "8da1b3bebbf100c8f6f3421321e36b3bd24d74db29e5666171d41eca9f423c8b03bcf1822fd7013f8d605e374c92dfc5c8bf47e0864d665ef06c168f4a4fa9b2";

const crypto = require("crypto");

const { MongoClient, ServerApiVersion ,ObjectId } = require("mongodb");

require("dotenv").config();

const port = 5000;

// console.log(process.env.MONGODB_USER)
// console.log(process.env.MONGODB_PASS)
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
    await client.connect();

    const db = client.db("eventAuraDB");
    const usersCollection = db.collection("users");
const eventsCollection = db.collection("events");

    // REGISTER
  app.post("/register", async (req, res) => {
  const { name, email, password, photoURL } = req.body;

  const existing = await usersCollection.findOne({ email });
  if (existing) return res.status(409).send({ message: "Email already in use" });

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
// Login route
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await usersCollection.findOne({ email }); // ✅ This works

  const hashed = hashPassword(password);

  if (!user || user.password !== hashed) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const jwt = require("jsonwebtoken"); // ✅ ensure this is at the top of your file

  const token = jwt.sign({ id: user._id, name: user.name }, SECRET, {
    expiresIn: "7d",
  });

  res.cookie("token", token, {
    httpOnly: true,
    secure: false, // ✅ use false for local dev
    sameSite: "Lax", // ✅ better dev compatibility
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  res.json({ user: { name: user.name, photoURL: user.photoURL } });
});

app.post("/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
  });
  res.sendStatus(200);
});

const authenticate = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.sendStatus(401);

  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.sendStatus(403);
  }
};

app.get("/me", authenticate, async (req, res) => {
  const user = await usersCollection.findOne({ _id: new ObjectId(req.user.id) });
  if (!user) return res.sendStatus(404);

  res.json({
    name: user.name,
    photoURL: user.photoURL,
  });
});


// router.post("/add-events", authMiddleware, async (req, res) => {
//   try {
//     const { title, dateTime, location, description, attendeeCount } = req.body;

//     const newEvent = new Event({
//       title,
//       name: req.user.name, // name from JWT payload
//       dateTime,
//       location,
//       description,
//       attendeeCount: attendeeCount || 0,
//     });

//     await newEvent.save();
//     res.status(201).json({ message: "Event added successfully", event: newEvent });
//   } catch (error) {
//     res.status(500).json({ message: "Server error", error });
//   }
// });

app.post("/add-events", authenticate, async (req, res) => {
  try {
    const { title, dateTime, location, description, attendeeCount } = req.body;

    const newEvent = {
      title,
      name: req.user.name, // ⬅️ fetched from JWT
      dateTime,
      location,
      description,
      attendeeCount: attendeeCount || 0,
    };

    const result = await eventsCollection.insertOne(newEvent);
    res.status(201).json({ message: "Event added successfully", eventId: result.insertedId });
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
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

app.listen(port, () => {
  console.log(`Event Aura api is running on ${port}`);
});
