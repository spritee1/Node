const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, createWebSocketStream } = require('ws');
const { TextDecoder } = require('util');

const uuid = (process.env.UUID || '5efabea4-f6d4-91fd-b8f0-17e004c89c60').replace(/-/g, "");
const port = process.env.PORT || 7860;

// --- 1. HTTP 服务 (网页 + 订阅) ---
const server = http.createServer((req, res) => {
    const url = req.url;
    
    // 首页：返回伪装 HTML
    if (url === '/') {
        const filePath = path.join(__dirname, 'index.html');
        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(500);
                res.end('Server Error');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(content);
            }
        });
    
    // 订阅页：自动生成 vless 链接
    } else if (url === '/sub') {
        const host = req.headers.host; // 自动获取当前域名 (如 xxx.hf.space)
        // 拼接 VLESS 链接
        // 格式: vless://UUID@HOST:443?encryption=none&security=tls&sni=HOST&type=ws&host=HOST&path=/&fp=chrome#Name
        const vlessLink = `vless://${process.env.UUID || '5efabea4-f6d4-91fd-b8f0-17e004c89c60'}@${host}:443?encryption=none&security=tls&sni=${host}&type=ws&host=${host}&path=%2F#HF-Node`;
        
        // Base64 加密 (标准的订阅格式)
        const base64Content = Buffer.from(vlessLink).toString('base64');
        
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(base64Content);

    } else {
        res.writeHead(404);
        res.end();
    }
});

// --- 2. WebSocket 服务 (VLESS 核心) ---
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    ws.once('message', (msg) => {
        const [VERSION] = msg;
        const id = msg.slice(1, 17);
        if (!id.every((v, i) => v === parseInt(uuid.substr(i * 2, 2), 16))) return;

        let i = msg.slice(17, 18).readUInt8() + 19;
        const targetPort = msg.slice(i, i += 2).readUInt16BE(0);
        const atyp = msg.slice(i, i += 1).readUInt8();

        let targetHost = '';
        if (atyp === 1) { 
            targetHost = msg.slice(i, i += 4).join('.');
        } else if (atyp === 3) { 
            const domainLen = msg.slice(i, i += 1).readUInt8();
            targetHost = new TextDecoder().decode(msg.slice(i, i += domainLen));
        } else if (atyp === 4) { 
            targetHost = msg.slice(i, i += 16).reduce((s, b, i, a) => (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), []).map(b => b.readUInt16BE(0).toString(16)).join(':');
        }

        ws.send(new Uint8Array([VERSION, 0]));

        const duplex = createWebSocketStream(ws);
        const tcpSocket = net.connect({ host: targetHost, port: targetPort }, function () {
            this.write(msg.slice(i));
            duplex.pipe(this).pipe(duplex);
        });

        tcpSocket.on('error', () => {});
        duplex.on('error', () => {});
    });
});

// --- 3. 启动 ---
server.listen(port, () => {
    console.log(`Server running at port ${port}`);
});
