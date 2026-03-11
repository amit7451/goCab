# 🚕 GoCab — MERN Stack Cab Booking App

A full-stack cab booking application built with **MongoDB, Express, React, and Node.js**. Passengers can book rides, drivers can accept and manage them — all in real time.

---

## ✨ Features

### Passenger
- Register and log in as a passenger
- Choose pickup & drop-off addresses
- Select ride type: Economy, Comfort, or Premium
- View estimated fare before booking
- Choose cash or card payment
- Track active rides with auto-refresh (every 15s)
- Rate completed rides (1–5 stars)
- Cancel pending rides
- Full ride history with status filters

### Driver
- Register with vehicle details and driver's license number
- Toggle online/offline availability
- Browse and accept available ride requests
- Manage active ride: start trip → complete trip
- Track total rides, earnings, and average rating
- View complete ride history

---

## 🗂 Project Structure

```
GoCab/
├── backend/                # Node.js + Express API
│   ├── server.js           # Entry point
│   ├── config/db.js        # MongoDB connection
│   ├── models/             # User, Driver, Ride schemas
│   ├── routes/             # Route declarations
│   ├── controllers/        # Business logic
│   └── middleware/         # JWT auth guard
│
├── frontend/               # React + Vite SPA
│   └── src/
│       ├── api/axios.js    # Axios instance with auth headers
│       ├── context/        # Auth context (global state)
│       ├── components/     # Navbar, RideCard, ProtectedRoute
│       └── pages/          # Home, Login, Register, BookRide, MyRides, DriverDashboard
│
└── README.md
```

---

## 🛠 Prerequisites

Make sure the following are installed on your machine:

| Tool | Version | Download |
|------|---------|----------|
| Node.js | v18+ | https://nodejs.org |
| npm | v9+ | Bundled with Node |
| MongoDB | v6+ | https://www.mongodb.com/try/download/community |
| Git | Latest | https://git-scm.com |

---

## 🚀 Setup Guide (Step by Step)

### Step 1 — Clone or download the project

```bash
git clone <your-repo-url> GoCab
cd GoCab
```

Or unzip the downloaded folder and `cd` into it.

---

### Step 2 — Start MongoDB

#### Option A: Local MongoDB
Make sure MongoDB is running on your machine:

```bash
# macOS (with Homebrew)
brew services start mongodb-community

# Ubuntu/Linux
sudo systemctl start mongod

# Windows
# Open Services and start "MongoDB"
# OR run: net start MongoDB
```

Verify it's running:
```bash
mongosh
# You should see the MongoDB shell prompt
exit
```

#### Option B: MongoDB Atlas (Cloud — Recommended for production)
1. Go to https://www.mongodb.com/atlas
2. Create a free cluster
3. Get your connection string (looks like: `mongodb+srv://<user>:<pass>@cluster.xxx.mongodb.net/gocab`)
4. Use this as your `MONGO_URI` in Step 4

---

### Step 3 — Set up the Backend

```bash
cd backend
npm install
```

---

### Step 4 — Configure Backend Environment Variables

```bash
# Copy the example env file
cp .env.example .env
```

Open `.env` and fill in your values:

```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/gocab
JWT_SECRET=change_this_to_a_long_random_secret_string
JWT_EXPIRES_IN=7d
CLIENT_URL=http://localhost:5173
```

> **Important:** Change `JWT_SECRET` to any long random string before deployment.
> Example: `JWT_SECRET=x9$Kp2mNvQ8rT6wY1uA4bE7hJ3cL0sD5`

---

### Step 5 — Start the Backend Server

```bash
# Development mode (auto-restarts on file changes)
npm run dev

# Production mode
npm start
```

You should see:
```
🚕 GoCab server running on port 5000
✅ MongoDB Connected: localhost
```

Test the API is alive:
```bash
curl http://localhost:5000/api/health
# Response: {"status":"GoCab API is running"}
```

---

### Step 6 — Set up the Frontend

Open a **new terminal** window:

```bash
cd frontend
npm install
```

---

### Step 7 — Configure Frontend Environment (Optional)

The frontend uses a Vite proxy by default so **no env file is required for local development**. The proxy in `vite.config.js` automatically forwards `/api` requests to `http://localhost:5000`.

If you want to point to a remote backend:
```bash
cp .env.example .env
# Edit VITE_API_URL to your backend URL
```

---

### Step 8 — Start the Frontend

```bash
npm run dev
```

You should see:
```
  VITE v5.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
```

---

### Step 9 — Open the App

Open your browser and go to: **http://localhost:5173**

---

## 🧪 Testing the Full Flow

### Create a Passenger Account
1. Click **Sign Up** → Select **I'm a Passenger**
2. Fill in name, email, phone, password
3. Click **Create Passenger Account**
4. You'll be redirected to the **Book Ride** page

### Book a Ride
1. Enter a pickup address (e.g., "Connaught Place, Delhi")
2. Enter a drop-off address (e.g., "Indira Gandhi Airport")
3. Choose a ride type and payment method
4. Click **Confirm Booking**

### Create a Driver Account (in a different browser/incognito)
1. Click **Sign Up** → Select **I'm a Driver**
2. Fill in all details including vehicle info and license number
3. Click **Create Driver Account**
4. You'll be on the **Driver Dashboard**

### Accept the Ride (as Driver)
1. Make sure the toggle shows **Online**
2. The passenger's ride request should appear in **Available** tab
3. Click **Accept Ride**
4. The ride appears in **My Rides** tab with active status
5. Click **Pick Up Passenger** → then **Complete Ride**

### Back as Passenger
1. Go to **My Rides** — the status updates automatically
2. Once completed, rate the driver with 1–5 stars

---

## 📡 API Reference

### Auth Routes (`/api/auth`)

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/register` | Public | Register user or driver |
| POST | `/login` | Public | Login and get JWT |
| GET | `/me` | Private | Get current user |

### Ride Routes (`/api/rides`)

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/book` | User | Book a new ride |
| GET | `/my-rides` | User | Get all rides for current user |
| GET | `/:id` | Private | Get a specific ride |
| PUT | `/:id/cancel` | User | Cancel a pending ride |
| PUT | `/:id/rate` | User | Rate a completed ride |

### Driver Routes (`/api/driver`)

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/profile` | Driver | Get driver profile |
| PUT | `/availability` | Driver | Toggle online/offline |
| PUT | `/location` | Driver | Update current location |
| GET | `/available-rides` | Driver | Get all pending rides |
| PUT | `/accept-ride/:rideId` | Driver | Accept a ride |
| PUT | `/update-ride/:rideId` | Driver | Update ride status |
| GET | `/my-rides` | Driver | Get driver's ride history |

---

## 🔐 Authentication

All protected routes require a **Bearer JWT token** in the Authorization header:

```
Authorization: Bearer <your_token>
```

The frontend handles this automatically via the Axios interceptor in `src/api/axios.js`.

---

## 💰 Fare Calculation

Fares are calculated server-side in `Ride.js`:

| Ride Type | Base Fare | Per Km Rate |
|-----------|-----------|-------------|
| Economy   | ₹30       | ₹12/km      |
| Comfort   | ₹50       | ₹18/km      |
| Premium   | ₹80       | ₹25/km      |

> Note: Distance is currently simulated (2–22 km random). In production, integrate Google Maps Distance Matrix API.

---

## 🔧 Useful Scripts

### Backend
```bash
npm run dev     # Start with nodemon (auto-reload)
npm start       # Start in production mode
```

### Frontend
```bash
npm run dev     # Start Vite dev server
npm run build   # Build for production
npm run preview # Preview production build
```

---

## 🚢 Deployment

### Backend (Render / Railway / Fly.io)
1. Push backend to GitHub
2. Connect to Render (https://render.com) → New Web Service
3. Set environment variables in the dashboard
4. Build command: `npm install`
5. Start command: `npm start`

### Frontend (Vercel / Netlify)
1. Push frontend to GitHub
2. Connect to Vercel (https://vercel.com)
3. Set `VITE_API_URL` environment variable to your deployed backend URL
4. Build command: `npm run build`
5. Output directory: `dist`

### Database
Use MongoDB Atlas for production — it's free for small projects.

---

## 🐛 Troubleshooting

**CORS error in browser?**
- Make sure `CLIENT_URL` in `.env` matches your frontend URL exactly (no trailing slash)

**MongoDB connection failed?**
- Ensure MongoDB is running: `mongosh` should open a shell
- Check the `MONGO_URI` in your `.env` file

**Port already in use?**
- Kill the process: `lsof -ti:5000 | xargs kill` (macOS/Linux)
- Or change the `PORT` in `.env`

**JWT errors after password change?**
- Clear `localStorage` in the browser developer tools and log in again

**"Driver profile not found" error?**
- This means the user registered with `role: driver` but no `Driver` document was created
- Re-register or check the `register` controller for errors

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'Add my feature'`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a pull request

---

## 📄 License

MIT License — free to use, modify, and distribute.

---

**Built with ❤️ using MongoDB, Express, React & Node.js**

# Team Behind the Project

This project was successfully developed through the combined efforts of our dedicated team. Each member contributed their unique skills in research, problem-solving, design, and implementation to bring the project to completion. Through collaboration, consistent communication, and shared responsibility, the team worked together to overcome challenges and deliver a well-structured solution while gaining valuable hands-on experience during the development process.

## Team Members

* **Member 1** – Aman Yadav
* **Member 2** – Amit kumar (30)
* **Member 3** – Amit Kumar (31)
* **Member 4** – Amit Kumar Verma

