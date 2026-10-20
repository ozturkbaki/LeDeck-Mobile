/**
 * VXPro UDP Discovery Service
 * Port: 5600
 * Protocol: UDP Broadcast
 */
import { UdpSocket } from 'capacitor-udp-socket';
import { TcpSocket } from 'capacitor-tcp-socket';

export const DiscoveryService = {
    _socketId: null,
    _isScanning: false,

    /**
     * Start scanning for devices
     * @param {Function} onDeviceFound Callback when a device is discovered
     * @param {Object} options { targetAddress, series, onProgress }
     */
    async scan(onDeviceFound, options = {}) {
        if (this._isScanning) return;
        this._isScanning = true;

        const { targetAddress = null, series = 'all', onProgress = null } = options;

        try {
            console.log(`[Discovery] Starting ${series} scan...`);
            if (!UdpSocket) throw new Error('UdpSocket plugin not found');

            // 1. Create Socket (UDP still useful for broad broadcast or specific probes)
            const createResult = await UdpSocket.create({ properties: {} });
            this._socketId = createResult.socketId;
            const localIp = createResult.ipv4 || '';
            console.log(`[Discovery] Local IP detected: ${localIp}`);

            // 2. Bind
            await UdpSocket.bind({ socketId: this._socketId, port: 0 });

            // 3. Listen for Responses
            UdpSocket.addListener('receive', (info) => {
                if (info.socketId !== this._socketId) return;
                this._handleResponse(info, onDeviceFound);
            });

            // 4. UDP Broad Broadcast (Only if series is 'all')
            if (!targetAddress && series === 'all') {
                const payloads = this._buildSearchPayloads();
                const addresses = ['255.255.255.255', '192.168.5.255', '192.168.41.1'];
                for (const payload of payloads) {
                    const bufferBase64 = btoa(String.fromCharCode(...payload));
                    for (const addr of addresses) {
                        try {
                            await UdpSocket.send({
                                socketId: this._socketId, address: addr, port: 5600, buffer: bufferBase64
                            });
                            await UdpSocket.send({
                                socketId: this._socketId, address: addr, port: 5201, buffer: bufferBase64
                            });
                        } catch (e) { }
                    }
                }
            }

            // 5. Specific IP Probe (UDP & TCP)
            if (targetAddress) {
                // UDP Probes
                const payloads = this._buildSearchPayloads();
                for (const payload of payloads) {
                    const bufferBase64 = btoa(String.fromCharCode(...payload));
                    const ports = series === 'TU' ? [5201] : (series === 'VX' ? [15200] : [5600, 5201]);
                    for (const port of ports) {
                        try {
                            await UdpSocket.send({
                                socketId: this._socketId, address: targetAddress, port: port, buffer: bufferBase64
                            });
                        } catch (e) { }
                    }
                }

                // H Series UDP Probe (Port 6000)
                if (series === 'all' || series === 'H') {
                    const hPayload = '[{"cmd":"W0101","deviceId":0}]';
                    const hBufferBase64 = btoa(hPayload);
                    try {
                        await UdpSocket.send({
                            socketId: this._socketId, address: targetAddress, port: 6000, buffer: hBufferBase64
                        });
                    } catch (e) { }
                }

                // TCP Probes (More reliable for manual IP entries, especially in emulators)
                const tcpPorts = series === 'TU' ? [5201] : (series === 'VX' ? [15200] : [5201, 15200]);
                for (const port of tcpPorts) {
                    await this._probeTcp(targetAddress, port, 1000, onDeviceFound);
                }
            }

            // 6. TCP Sweep (Masaüstü yazılımın kullandığı garantici yöntem - Optimized)
            const isEmulator = localIp.startsWith('10.0.2.');
            if (!targetAddress) {
                await this._tcpSweep(series, localIp, onDeviceFound, onProgress, isEmulator);
            }

            // Tarama tamamlandı
            await this.stop();

        } catch (err) {
            console.error('[Discovery] Scan Error:', err);
            this._isScanning = false;
            throw err;
        }
    },

    async stop() {
        if (this._socketId) {
            try {
                await UdpSocket.close({ socketId: this._socketId });
                UdpSocket.removeAllListeners();
            } catch (e) { }
            this._socketId = null;
        }
        this._isScanning = false;
    },

    /**
     * TCP Sweep: Ağdaki tüm IP'leri hedeflenmiş portlardan tarar.
     */
    async _tcpSweep(series, localIp, callback, onProgress, isEmulator = false) {
        console.log(`[Discovery] TCP Sweep for ${series} series (emulator: ${isEmulator})...`);

        // Detect current subnet from localIp
        let subnets = [];
        const ipParts = (localIp || '').split('.');
        if (ipParts.length === 4) {
            const currentSubnet = ipParts.slice(0, 3).join('.');

            // Emulator detection: if in 10.0.2.x, skip emulator subnet and only scan real LAN subnets
            if (currentSubnet === '10.0.2') {
                console.log('[Discovery] Emulator detected (10.0.2.x). Scanning real LAN subnets only.');
                subnets = ['192.168.5', '192.168.1', '192.168.0', '192.168.41'];
            } else {
                subnets = [currentSubnet];
            }

            console.log(`[Discovery] Target subnets: ${subnets.join('.x, ')}.x`);
        } else {
            console.log('[Discovery] Local IP not detected. Falling back to common subnets.');
            subnets = ['192.168.5', '192.168.1', '192.168.0', '192.168.41'];
        }

        // Port mapping: TU=5201, VX=15200
        let ports = [];
        if (series === 'TU') ports = [5201];
        else if (series === 'VX') ports = [15200];
        else ports = [5201, 15200];

        const timeout = isEmulator ? 2000 : 500; // Emülatör için daha uzun timeout (NAT gecikmesi)
        const batchSize = isEmulator ? 5 : 10; // Emülatör için daha küçük batch

        let processed = 0;
        const total = subnets.length * 254;

        for (const subnet of subnets) {
            if (onProgress) onProgress(`${subnet}.x taranıyor...`, Math.floor((processed / total) * 100));

            for (let i = 1; i <= 254; i += batchSize) {
                if (!this._isScanning) return;

                const probes = [];
                for (let j = i; j < i + batchSize && j <= 254; j++) {
                    const ip = `${subnet}.${j}`;
                    for (const port of ports) {
                        probes.push(this._probeTcp(ip, port, timeout, callback, isEmulator));
                    }
                    if (series === 'all' || series === 'H') {
                        probes.push(this._probeUdpH(ip, timeout, callback));
                    }
                }
                await Promise.all(probes);
                processed += batchSize;

                // Update progress every batch
                if (onProgress) {
                    onProgress(`${subnet}.${Math.min(i + batchSize, 254)} taranıyor...`, Math.floor((processed / total) * 100));
                }
            }
        }
        if (onProgress) onProgress('Tarama tamamlandı.', 100);
    },

    async _probeTcp(ip, port, timeout, callback, isEmulator = false) {
        try {
            const result = await Promise.race([
                TcpSocket.connect({ ipAddress: ip, port: port, timeout: timeout }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout))
            ]);

            // If we reach here, the connection was successful (didn't timeout or throw)
            console.log(`[Discovery] ✅ Probable device at ${ip}:${port}`);
            // Properly disconnect using the client ID returned by connect()
            if (result && result.client !== undefined) {
                try { await TcpSocket.disconnect({ client: result.client }); } catch (e) { }
            }

            const type = port === 5201 ? 'TU' : 'VX';
            callback({
                ip: ip,
                port: port,
                SN: (type === 'TU' ? 'TU-' : 'VX-') + ip.split('.').pop(),
                deviceName: type === 'TU' ? 'TU Series Device' : 'VXPro Device',
                type: type,
                isVerified: false
            });
        } catch (e) { }
    },

    async _probeUdpH(ip, timeout, callback) {
        if (!this._socketId) return;
        try {
            const hPayload = '[{"cmd":"W0101","deviceId":0}]';
            const hBufferBase64 = btoa(hPayload);
            await UdpSocket.send({
                socketId: this._socketId,
                address: ip,
                port: 6000,
                buffer: hBufferBase64
            });
        } catch (e) { }
    },

    _handleResponse(info, callback) {
        try {
            const binaryString = atob(info.buffer);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // TU Series uses AA 55 header
            if (bytes[0] === 0xAA && bytes[1] === 0x55) {
                callback({
                    ip: info.remoteAddress,
                    port: 5201,
                    SN: 'TU-' + info.remoteAddress.split('.').pop(),
                    deviceName: 'TU Series Device',
                    isVerified: true,
                    type: 'TU'
                });
                return;
            }

            // H Series JSON Header ([)
            if (bytes[0] === 0x5b) {
                try {
                    const jsonPart = new TextDecoder().decode(bytes);
                    const data = JSON.parse(jsonPart);
                    if (Array.isArray(data) && data.length > 0) {
                        const firstCmd = data[0];
                        if (firstCmd.cmd === 'W0101' || firstCmd.ack === 'Ok') {
                            callback({
                                ip: info.remoteAddress,
                                port: 6000,
                                SN: 'H-' + info.remoteAddress.split('.').pop(),
                                deviceName: 'H Series Device',
                                isVerified: true,
                                type: 'H'
                            });
                            return;
                        }
                    }
                } catch (e) { }
            }

            // VXPro uses 55 AA header and has JSON at offset 40
            if (bytes[0] === 0x55 && bytes[1] === 0xAA && bytes.length >= 40) {
                try {
                    const jsonPart = new TextDecoder().decode(bytes.slice(40));
                    const deviceData = JSON.parse(jsonPart);
                    deviceData.ip = info.remoteAddress;
                    deviceData.port = 5600;
                    deviceData.type = 'VX';
                    callback(deviceData);
                } catch (e) { }
            }
        } catch (e) { }
    },

    _buildSearchPayloads() {
        return [
            new Uint8Array([0x55, 0xaa, 0x00, 0x10, 0xfe, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x64, 0x56]),
            new Uint8Array([0x55, 0xaa, 0x00, 0x00, 0xfe, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x00, 0x57, 0x56])
        ];
    }
};
