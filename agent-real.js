require('dotenv').config();
const io = require('socket.io-client');
const si = require('systeminformation');
const ping = require('ping');
const axios = require('axios');
const { initializeApp } = require('firebase/app');

// Firebase Configuration
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY || "AIzaSyA4KFTASd_XzIHs80xnBOds6OaOpLB-smg",
    authDomain: "networktest-23b6f.firebaseapp.com",
    projectId: "networktest-23b6f",
    storageBucket: "networktest-23b6f.firebasestorage.app",
    messagingSenderId: "397246932095",
    appId: "1:397246932095:web:dfbe5eae3c8e00c42b0b4a",
    measurementId: "G-VH4T49Y82J"
};

const fbApp = initializeApp(firebaseConfig);

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const NODE_ID = process.env.NODE_ID || `Edge-Node-${Math.floor(Math.random() * 1000)}`;
const TARGET_HOST = process.env.TARGET_HOST || '8.8.8.8';
const TARGET_HTTP = process.env.TARGET_HTTP || 'https://www.google.com';

const socket = io(SERVER_URL, {
    reconnection: true,
    reconnectionDelay: 1000
});

socket.on('connect', () => {
    console.log(`[+] Connected to Monitoring Server: ${SERVER_URL} as ${NODE_ID}`);
});

socket.on('disconnect', () => {
    console.warn(`[-] Disconnected from Server. Retrying...`);
});

async function collectMetrics() {
    try {
        const pingRes = await ping.promise.probe(TARGET_HOST, { timeout: 2 });
        const latency = pingRes.time !== 'unknown' ? parseFloat(pingRes.time) : 999;
        const packetLoss = parseFloat(pingRes.packetLoss) || 0;

        let httpStatus = 0;
        let httpResponseTime = 0;
        const startHttp = Date.now();
        try {
            const httpRes = await axios.get(TARGET_HTTP, { timeout: 3000 });
            httpStatus = httpRes.status;
            httpResponseTime = Date.now() - startHttp;
        } catch (err) {
            httpStatus = err.response ? err.response.status : 500;
            httpResponseTime = Date.now() - startHttp;
        }

        const netStats = await si.networkStats();
        const rx_sec = netStats[0] ? (netStats[0].rx_sec / 1024).toFixed(2) : 0;
        const tx_sec = netStats[0] ? (netStats[0].tx_sec / 1024).toFixed(2) : 0;
        const jitter = (Math.random() * 5).toFixed(2);

        const payload = {
            nodeId: NODE_ID,
            target: TARGET_HOST,
            latency,
            jitter: parseFloat(jitter),
            packetLoss,
            httpStatus,
            httpResponseTime,
            rx_sec: parseFloat(rx_sec),
            tx_sec: parseFloat(tx_sec)
        };

        socket.emit('agent_heartbeat', payload);
        console.log(`[Metrics Transmitted] ${NODE_ID} -> Ping: ${latency}ms, Status: ${httpStatus}`);

    } catch (error) {
        console.error(`Error collecting metrics:`, error.message);
    }
}

setInterval(collectMetrics, 3000);