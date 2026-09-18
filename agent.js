// agent.js
const os = require('os');
const dns = require('dns').promises;
const http = require('http');
const si = require('systeminformation');
const WebSocket = require('ws');

const CONFIG = {
    nodeId: process.env.NODE_ID || 'Node-BKK-01',
    location: process.env.LOCATION || 'Bangkok Datacenter (Zone A)',
    serverUrl: 'ws://localhost:8080',
    pingTarget: '8.8.8.8',
    httpTarget: 'http://www.google.com',
    dnsTarget: 'google.com',
    intervalMs: 3000
};

let previousNetStats = null;
let pingHistory = [];
const startUptime = Date.now();

// Utility Functions
const measurePing = async (target) => {
    try {
        const res = await si.inetLatency(target);
        return res || 0;
    } catch {
        return 999;
    }
};

const measureHttp = async (url) => {
    const start = Date.now();
    return new Promise((resolve) => {
        const req = http.get(url, (res) => {
            resolve({ latency: Date.now() - start, status: res.statusCode.toString() });
        });
        req.on('error', () => resolve({ latency: 999, status: 'ERR' }));
        req.setTimeout(3000, () => { req.destroy(); resolve({ latency: 999, status: 'TIMEOUT' }); });
    });
};

const measureDns = async (domain) => {
    const start = Date.now();
    try {
        await dns.resolve(domain);
        return Date.now() - start;
    } catch {
        return 999;
    }
};

const getMetrics = async () => {
    // 1. Network Latency & Jitter
    const currentPing = await measurePing(CONFIG.pingTarget);
    pingHistory.push(currentPing);
    if (pingHistory.length > 10) pingHistory.shift();
    
    // Jitter calculation
    let jitter = 0;
    if (pingHistory.length > 1) {
        let diffs = 0;
        for (let i = 1; i < pingHistory.length; i++) {
            diffs += Math.abs(pingHistory[i] - pingHistory[i-1]);
        }
        jitter = diffs / (pingHistory.length - 1);
    }

    // Packet loss estimation (based on history failures > 500ms)
    const lostPackets = pingHistory.filter(p => p > 500).length;
    const packetLoss = (lostPackets / pingHistory.length) * 100;

    // 2. Bandwidth & Errors (Delta calculation)
    const netStatsArray = await si.networkStats();
    const netStats = netStatsArray[0] || {};
    let rxRate = 0, txRate = 0;
    
    if (previousNetStats) {
        const timeDiff = (Date.now() - previousNetStats.time) / 1000;
        rxRate = ((netStats.rx_bytes - previousNetStats.rx_bytes) * 8 / 1000000) / timeDiff; // Mbps
        txRate = ((netStats.tx_bytes - previousNetStats.tx_bytes) * 8 / 1000000) / timeDiff; // Mbps
    }
    previousNetStats = { rx_bytes: netStats.rx_bytes, tx_bytes: netStats.tx_bytes, time: Date.now() };

    const netErrors = (netStats.rx_errors || 0) + (netStats.tx_errors || 0) + 
                      (netStats.rx_drop || 0) + (netStats.tx_drop || 0);

    // 3. Application Metrics
    const httpRes = await measureHttp(CONFIG.httpTarget);
    const dnsLatency = await measureDns(CONFIG.dnsTarget);
    const activeConns = (await si.networkConnections()).length;

    // 4. Payload Assembly
    return {
        nodeId: CONFIG.nodeId,
        location: CONFIG.location,
        latency: Math.round(currentPing),
        jitter: parseFloat(jitter.toFixed(2)),
        packetLoss: parseFloat(packetLoss.toFixed(1)),
        netErrors: netErrors,
        rxRate: parseFloat((rxRate > 0 ? rxRate : 0).toFixed(2)),
        txRate: parseFloat((txRate > 0 ? txRate : 0).toFixed(2)),
        httpLatency: httpRes.latency,
        httpStatus: httpRes.status,
        dnsLatency: dnsLatency,
        activeConns: activeConns,
        uptime: Math.floor((Date.now() - startUptime) / 1000),
        timestamp: new Date().toISOString()
    };
};

// WebSocket Agent Loop
function startAgent() {
    const ws = new WebSocket(CONFIG.serverUrl);

    ws.on('open', () => {
        console.log(`[Agent] Connected to Monitor Server (${CONFIG.nodeId})`);
        setInterval(async () => {
            const data = await getMetrics();
            ws.send(JSON.stringify(data));
        }, CONFIG.intervalMs);
    });

    ws.on('close', () => {
        console.log('[Agent] Disconnected. Reconnecting in 5s...');
        setTimeout(startAgent, 5000);
    });

    ws.on('error', (err) => console.error('[Agent Error]', err.message));
}

startAgent();