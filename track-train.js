#!/usr/bin/env node

/**
 * Amtrak Train 194 Tracker
 * Uses the `amtrak` npm package (Amtrak.js) to fetch real-time train data
 * from the Amtraker v3 API (https://api-v3.amtraker.com/v3/).
 *
 * Train 194: Northeast Regional, Washington DC (WAS) -> Boston (BOS)
 * Key stations for this tracker: NYP (New York Penn), PVD (Providence)
 *
 * Usage: node track-train.js
 */

const { fetchTrain } = require("amtrak");
const fs = require("fs");

const TRAIN_NUMBER = "194";
const STATE_FILE = "./tracker-state.json";

// Load previous state for dedup
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { lastAmtrakUpdate: null, phase: "pre-nyp", trainArrived: false };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Find station by code in the stations array
function findStation(stations, code) {
  return stations.find((s) => s.code === code);
}

// Determine the next station the train will arrive at
function getNextStation(stations) {
  for (const station of stations) {
    if (station.status === "Enroute") {
      return station;
    }
  }
  return null;
}

// Parse timeliness from trainTimely or statusMsg
function getTimelinessInfo(train) {
  const timely = train.trainTimely || "";
  const statusMsg = train.statusMsg || "";

  if (
    timely.toLowerCase().includes("on time") ||
    statusMsg.toLowerCase().includes("on time")
  ) {
    return { onTime: true, message: "On Time" };
  }

  // Extract delay/ahead info
  const lateMatch =
    timely.match(/(\d+)\s*(?:min|minute)/i) ||
    statusMsg.match(/(\d+)\s*(?:min|minute)/i);
  if (lateMatch) {
    const minutes = parseInt(lateMatch[1]);
    if (timely.toLowerCase().includes("late") || statusMsg.toLowerCase().includes("late")) {
      return { onTime: false, message: `${minutes} minutes late` };
    }
    if (timely.toLowerCase().includes("early") || statusMsg.toLowerCase().includes("early")) {
      return { onTime: false, message: `${minutes} minutes early` };
    }
  }

  return { onTime: null, message: statusMsg || timely || "Unknown" };
}

// Calculate minutes until scheduled arrival at a station
function minutesUntilArrival(station) {
  if (!station || !station.schArr) return Infinity;

  const now = new Date();
  // schArr format varies - try parsing directly
  const arrTime = new Date(station.schArr);
  if (isNaN(arrTime.getTime())) return Infinity;

  return (arrTime.getTime() - now.getTime()) / 60000;
}

// Determine the current tracking phase
function determinePhase(stations) {
  const nyp = findStation(stations, "NYP");
  const pvd = findStation(stations, "PVD");

  if (!nyp || !pvd) return "unknown";

  // If PVD has been departed or arrived
  if (pvd.status === "Departed") return "arrived-pvd";
  if (pvd.status === "Station") return "at-pvd";

  // If NYP has been departed
  if (nyp.status === "Departed") return "post-nyp";

  // If approaching NYP (within 15 min)
  const minsToNYP = minutesUntilArrival(nyp);
  if (minsToNYP <= 15 && minsToNYP > 0) return "approaching-nyp";

  // If at NYP
  if (nyp.status === "Station") return "at-nyp";

  return "pre-nyp";
}

// Get recommended poll interval based on phase
function getRecommendedInterval(phase) {
  switch (phase) {
    case "approaching-nyp":
    case "at-nyp":
      return "2m"; // 2 minutes near NYP
    case "arrived-pvd":
    case "at-pvd":
      return "stop"; // Train arrived at PVD, stop tracking
    default:
      return "15m"; // 15 minutes default
  }
}

async function checkTrain() {
  const state = loadState();
  const timestamp = new Date().toISOString();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`AMTRAK TRAIN ${TRAIN_NUMBER} STATUS CHECK`);
  console.log(`Update received: ${timestamp}`);
  console.log(`${"=".repeat(60)}`);

  try {
    const data = await fetchTrain(TRAIN_NUMBER);

    // The response is keyed by train number
    const trains = data[TRAIN_NUMBER] || data[Object.keys(data)[0]];
    if (!trains || trains.length === 0) {
      console.log("No active train found for train 194.");
      console.log("The train may not have departed yet or may have completed its journey.");
      saveState({ ...state, lastCheck: timestamp });
      return;
    }

    // Use the first (or most relevant) train instance
    // For today's train, the ID would be "194-<day>"
    const today = new Date().getDate();
    let train = trains.find((t) => t.trainID === `${TRAIN_NUMBER}-${today}`) || trains[0];

    const amtrakUpdated = train.updatedAt || train.lastValTS || "Unknown";
    const timeliness = getTimelinessInfo(train);
    const nextStation = getNextStation(train.stations);
    const nyp = findStation(train.stations, "NYP");
    const pvd = findStation(train.stations, "PVD");
    const phase = determinePhase(train.stations);

    // Check if this is new information from Amtrak
    const isNewUpdate = state.lastAmtrakUpdate !== amtrakUpdated;

    // In approaching-nyp or post-nyp phases, only report if new data
    if (!isNewUpdate && (phase === "approaching-nyp" || phase === "at-nyp")) {
      console.log(`No new Amtrak update since: ${amtrakUpdated}`);
      console.log("Skipping duplicate update.");
      return;
    }

    // Print status
    console.log(`\nAmtrak last updated: ${amtrakUpdated}`);
    console.log(`Route: ${train.routeName} (${train.origName} -> ${train.destName})`);
    console.log(`Train state: ${train.trainState}`);
    console.log(`\nLOCATION:`);
    console.log(`  Coordinates: ${train.lat}, ${train.lon}`);
    console.log(`  Heading: ${train.heading}`);
    console.log(`  Velocity: ${train.velocity} mph`);
    console.log(`  Last event: ${train.eventName} (${train.eventCode})`);

    console.log(`\nTIMELINESS:`);
    console.log(`  Status: ${timeliness.message}`);
    console.log(`  Status message: ${train.statusMsg}`);

    if (nextStation) {
      console.log(`\nNEXT STATION:`);
      console.log(`  Name: ${nextStation.name} (${nextStation.code})`);
      console.log(`  Scheduled arrival: ${nextStation.schArr}`);
      console.log(`  Estimated arrival: ${nextStation.arr || "N/A"}`);
      console.log(`  Arrival comment: ${nextStation.arrCmnt || "N/A"}`);
      console.log(`  Track/Platform: ${nextStation.platform || "Not yet assigned"}`);
    }

    if (nyp) {
      console.log(`\nNYP (New York Penn) STATUS:`);
      console.log(`  Station status: ${nyp.status}`);
      console.log(`  Scheduled arrival: ${nyp.schArr}`);
      console.log(`  Estimated arrival: ${nyp.arr || "N/A"}`);
      console.log(`  Arrival comment: ${nyp.arrCmnt || "N/A"}`);
      console.log(`  Departure comment: ${nyp.depCmnt || "N/A"}`);
      console.log(`  Track/Platform: ${nyp.platform || "Not yet assigned"}`);
    }

    if (pvd) {
      console.log(`\nPVD (Providence) STATUS:`);
      console.log(`  Station status: ${pvd.status}`);
      console.log(`  Scheduled arrival: ${pvd.schArr}`);
      console.log(`  Estimated arrival: ${pvd.arr || "N/A"}`);
      console.log(`  Arrival comment: ${pvd.arrCmnt || "N/A"}`);
      console.log(`  Track/Platform: ${pvd.platform || "Not yet assigned"}`);
    }

    console.log(`\nTRACKING PHASE: ${phase}`);
    console.log(`Recommended poll interval: ${getRecommendedInterval(phase)}`);

    if (train.alerts && train.alerts.length > 0) {
      console.log(`\nALERTS:`);
      train.alerts.forEach((alert, i) => {
        console.log(`  ${i + 1}. ${alert.message}`);
      });
    }

    // Save state
    saveState({
      lastAmtrakUpdate: amtrakUpdated,
      lastCheck: timestamp,
      phase,
      trainArrived: phase === "arrived-pvd" || phase === "at-pvd",
      recommendedInterval: getRecommendedInterval(phase),
    });

    if (phase === "arrived-pvd" || phase === "at-pvd") {
      console.log(`\n*** TRAIN HAS ARRIVED AT PVD - TRACKING COMPLETE ***`);
    }
  } catch (err) {
    console.error(`\nERROR fetching train data: ${err.message}`);
    console.log("The Amtraker API may be temporarily unavailable.");
    console.log("This can happen if:");
    console.log("  - The train hasn't departed yet today");
    console.log("  - The API is rate-limited or down");
    console.log("  - Network connectivity issues");
    saveState({ ...state, lastCheck: timestamp, lastError: err.message });
  }
}

// Run
checkTrain();
