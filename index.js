require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const cors = require("cors");
/** @type {typeof import("node-fetch").default} */
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));
const jwt = require("jsonwebtoken");

const app = express();
const port = process.env.PORT || 4000;

app.use(bodyParser.json(), cors());
app.options("*", cors());

/*********** token */
const jwtPayload = {
  iss: process.env.ZOOM_JWT_API_KEY,
  exp: new Date().getTime() + 5000,
};
const jwtToken = jwt.sign(jwtPayload, process.env.ZOOM_JWT_API_SECRET);
console.log("jwtToken:", jwtToken)

/*********** custom state */
let meetingData = null;
let signatureRole0 = null;
let signatureRole1 = null;

function generateSignature(apiKey, apiSecret, meetingNumber, role) {
  // Prevent time sync issue between client signature generation and zoom 
  const timestamp = new Date().getTime() - 30000
  const msg = Buffer.from(apiKey + meetingNumber + timestamp + role).toString('base64')
  const hash = crypto.createHmac('sha256', apiSecret).update(msg).digest('base64')
  const signature = Buffer.from(`${apiKey}.${meetingNumber}.${timestamp}.${role}.${hash}`).toString('base64')

  return signature
}

/*********** rest apis */
app.post("/create-user", async (req, res) => {
  try {
    const { first_name, last_name, email } = req.body;
    const response = await fetch("https://api.zoom.us/v2/users", {
      method: "POST",
      body: JSON.stringify({
        action: "custCreate",
        user_info: {
          email,
          type: 1,
          first_name,
          last_name,
        },
      }),
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + jwtToken,
      },
    });
    const result = await response.json()

    return res.send({ status: true, ...result });
  } catch (error) {
    console.log("Error: /create-user ", error);
    return res.send({ status: false });
  }
});

app.get("/create-meeting/:email", async (req, res) => {
  const email = req.params.email;

  try {
    const response = await fetch(
      `https://api.zoom.us/v2/users/${email}/meetings?type=live`,
      {
        method: "GET",
        headers: {
          Authorization: "Bearer " + jwtToken,
        }
      }
    );
    const { meetings } = await response.json();
    // if no live meeting is going on but meetingData is there then clear it.
    if (!meetings.length && meetingData)
      meetingData = null
  } catch (error) {
    return res.send({ status: false });
  }

  if (meetingData) return res.send({ ...meetingData, signature: signatureRole1 });

  try {
    const response = await fetch(
      `https://api.zoom.us/v2/users/${email}/meetings`,
      {
        method: "POST",
        body: JSON.stringify({
          topic: "test create meeting",
          type: 1,
          settings: {
            host_video: "false",
            waiting_room: "true"
          },
        }),
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + jwtToken,
        }
      }
    );
    const { id, password, join_url } = await response.json();
    meetingData = { id, password, join_url };
    signatureRole0 = generateSignature(process.env.ZOOM_JWT_API_KEY, process.env.ZOOM_JWT_API_SECRET, id, 0)
    signatureRole1 = generateSignature(process.env.ZOOM_JWT_API_KEY, process.env.ZOOM_JWT_API_SECRET, id, 1)
    return res.send({ ...meetingData, signature: signatureRole1 });
  } catch (error) {
    console.log("Error: /create-meeting/:email ", error);
    return res.send({ status: false });
  }
});

app.get("/join-meeting", async (req, res) => {
  if (meetingData) return res.send({ ...meetingData, signature: signatureRole0 });
  return res.send({ status: false });
});

app.listen(port, () =>
  console.log(`Zoom Web Meeting SDK Sample Signature Node.js on port ${port}!`)
);
