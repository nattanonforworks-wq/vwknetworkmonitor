const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// 1. กำหนด CORS ให้รัดกุมขึ้น (หรือใส่ process.env.ALLOWED_ORIGINS)
const io = new Server(server, {
    cors: {
        origin: process.env.NODE_ENV === 'production' ? false : "*",
        methods: ["GET", "POST"]
    }
});

// 2. Middlewares
app.use(express.static(path.join(__dirname, 'public'))); // ระบุ path แบบแน่นอน
app.use(express.json({ limit: '10mb' })); // ป้องกัน Payload ขนาดใหญ่เกินไป

// 3. Serving Pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/agent.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'agent.html'));
});

// 4. API Endpoints
app.post('/api/speedtest/upload', (req, res) => {
    res.status(200).send({ status: 'ok' });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    // แนะนำ: เปลี่ยนไปใช้ Environment Variable ใน Production
    const ADMIN_USER = process.env.ADMIN_USER || 'rootadmin';
    const ADMIN_PASS = process.env.ADMIN_PASS || '@rootadmin';

    if (username === ADMIN_USER && password === ADMIN_PASS) {
        res.status(200).json({ 
            success: true, 
            token: 'admin-authorized-token-' + Date.now() 
        });
    } else {
        res.status(401).json({ 
            success: false, 
            message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง!' 
        });
    }
});

// In-Memory Database สำหรับเก็บข้อมูล Nodes
let nodes = {};

// 5. Heartbeat Health Check (ตรวจจับ Node สัญญาณขาดเกิน 8 วินาที)
const HEARTBEAT_TIMEOUT = 8000;
const CHECK_INTERVAL = 3000;

setInterval(() => {
    const now = Date.now();
    let updated = false;

    Object.keys(nodes).forEach(nodeId => {
        const node = nodes[nodeId];
        // ตรวจสอบว่า Node ขาดการส่งสัญญาณ และยังไม่ได้ตั้งค่าเป็น CRITICAL_OFFLINE
        if (now - node.lastSeen > HEARTBEAT_TIMEOUT && node.status !== 'CRITICAL_OFFLINE') {
            nodes[nodeId] = {
                ...node,
                status: 'CRITICAL_OFFLINE',
                latency: 0,
                jitter: 0,
                packetLoss: 100,
                rxRate: '0.00',
                txRate: '0.00',
                httpStatus: 'DOWN',
                dnsLatency: 0
            };
            updated = true;
        }
    });

    if (updated) {
        io.emit('status_update', nodes);
    }
}, CHECK_INTERVAL);

// 6. Socket.io Real-time Handlers
io.on('connection', (socket) => {
    // ส่ง State ล่าสุดให้ Client ที่เพิ่ง Connect เข้ามา
    socket.emit('status_update', nodes);

    // รับข้อมูล Heartbeat จาก Agent
    socket.on('agent_heartbeat', (data) => {
        if (!data || !data.nodeId) return;

        const prevNode = nodes[data.nodeId];
        const totalChecks = (prevNode?.totalChecks || 0) + 1;
        const successChecks = (prevNode?.successChecks || 0) + (data.packetLoss < 50 ? 1 : 0);
        const slaScore = ((successChecks / totalChecks) * 100).toFixed(2);

        nodes[data.nodeId] = {
            nodeId: data.nodeId,
            location: data.location || 'Unknown',
            status: data.packetLoss > 20 ? 'WARNING' : 'HEALTHY',
            latency: data.latency || 0,
            jitter: data.jitter || 0,
            packetLoss: data.packetLoss || 0,
            rxRate: data.rxRate || '0.00',
            txRate: data.txRate || '0.00',
            netErrors: data.netErrors || 0,
            httpLatency: data.httpLatency || 0,
            httpStatus: data.httpStatus || 'N/A',
            dnsLatency: data.dnsLatency || 0,
            activeConns: data.activeConns || 1,
            slaScore: slaScore,
            totalChecks: totalChecks,
            successChecks: successChecks,
            uptime: data.uptime || 0,
            lastSeen: Date.now()
        };

        io.emit('status_update', nodes);
    });

    // ลบ Agent ออกจากระบบ Monitor
    socket.on('remove_agent', (data) => {
        if (data && data.nodeId && nodes[data.nodeId]) {
            delete nodes[data.nodeId];
            io.emit('status_update', nodes);
            console.log(`[Node Removed] Node ID: ${data.nodeId}`);
        }
    });
});

// 7. Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🔥 Grand Master Network Monitor Server running on port ${PORT}`);
});