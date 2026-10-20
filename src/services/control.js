/**
 * LEDECA VXPro Control Service (TCP)
 * Port: 15200 (Searching/General Control)
 */
import { TcpSocket } from 'capacitor-tcp-socket';
import { UdpSocket } from 'capacitor-udp-socket';

export const ControlService = {
    _clientId: null,
    _connectedIp: null,
    _connectedPort: null,
    _deviceType: null,  // 'TU' | 'VX'
    _tuCommandQueue: Promise.resolve(),

    /**
     * Check if currently connected
     */
    isConnected() {
        return this._connectedIp !== null;
    },

    /**
     * Get connected IP
     */
    getConnectedIp() {
        return this._connectedIp;
    },

    /**
     * Connect to the device via TCP
     * @param {string} ip Device IP address
     * @param {number} port default 15200
     */
    async connect(ip, port = 15200) {
        if (this._clientId !== null && this._connectedIp === ip) {
            return true; // Already connected
        }

        try {
            console.log(`[TCP] Connecting to ${ip}:${port}...`);

            // H serisi için UDP kontrolü (bağlantı kurmaya gerek yok, stateless)
            if (port === 6000) {
                this._clientId = 'H_UDP_STATELESS';
                this._connectedIp = ip;
                this._connectedPort = port;
                this._deviceType = 'H';
                console.log('[UDP] H Series initialized (stateless)');
                return true;
            }

            const result = await TcpSocket.connect({
                ipAddress: ip,
                port: port
            });

            this._clientId = result.client;
            this._connectedIp = ip;
            this._connectedPort = port;
            this._deviceType = port === 5201 ? 'TU' : 'VX';
            console.log('[TCP] Connected successfully, clientId:', this._clientId, 'type:', this._deviceType);

            // TU cihazları connection'ı kendisi kapattığı veya tek socket desteklediği için 
            // kontrol bağlantısını hemen kapatıp boşa çıkarıyoruz
            if (this._deviceType === 'TU') {
                try { await TcpSocket.disconnect({ client: this._clientId }); } catch (e) {}
                this._clientId = 'TU_STATELESS'; // indicates we are in stateless mode
            }

            return true;
        } catch (err) {
            console.error('[TCP] Connection error:', err);
            this._clientId = null;
            this._connectedIp = null;
            this._connectedPort = null;
            this._deviceType = null;
            throw err;
        }
    },

    /**
     * TU Serisi: Her komut için yeni bağlantı aç, gönder, oku, kapat.
     * Masaüstü yazılımıyla aynı yaklaşım (stateless per-command connection).
     * @param {Uint8Array} command Raw bytes to send
     * @returns {Promise<Uint8Array>} Response bytes
     */
    async sendTuCommand(command) {
        // Enqueue the command to prevent simultaneous sockets
        const currentTask = this._tuCommandQueue.then(() => this._executeTuCommand(command));
        // Catch errors so exceptions don't break the queue for future commands
        this._tuCommandQueue = currentTask.catch(() => {});
        return currentTask;
    },

    async _executeTuCommand(command) {
        const ip = this._connectedIp;
        const port = this._connectedPort || 5201;

        if (!ip) throw new Error('Not connected (no IP)');

        const logHex = Array.from(command).map(b => b.toString(16).padStart(2, '0')).join(' ');
        console.log(`[TU] SEND (${command.length}B): ${logHex}`);

        let tempClient = null;
        try {
            // Yeni bağlantı
            const conn = await TcpSocket.connect({ ipAddress: ip, port: port });
            tempClient = conn.client;

            // Gönder
            const binaryString = String.fromCharCode(...command);
            await TcpSocket.send({ client: tempClient, data: binaryString });

            // Yanıt bekle
            await new Promise(r => setTimeout(r, 200));
            let readResult = null;
            try {
                const readPromise = TcpSocket.read({ client: tempClient, expectLen: 64, timeout: 3 });
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('JS Read Timeout')), 3500));
                readResult = await Promise.race([readPromise, timeoutPromise]);
            } catch (readErr) {
                // "Connection closed by remote" veya timeout — normal durum
                console.log('[TU] Read ended:', readErr?.message || readErr);
            }

            let resBytes = new Uint8Array(0);
            if (readResult && readResult.result && readResult.result.length > 0) {
                resBytes = new Uint8Array(readResult.result.length);
                for (let i = 0; i < readResult.result.length; i++) {
                    resBytes[i] = readResult.result.charCodeAt(i);
                }
                const resHex = Array.from(resBytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
                console.log(`[TU] RECV (${resBytes.length}B): ${resHex}`);
            }

            return resBytes;
        } finally {
            // Her durumda bağlantıyı kapat
            if (tempClient !== null) {
                try { await TcpSocket.disconnect({ client: tempClient }); } catch (e) { }
            }
            // Cihazın yeni bir socket açabilmesi için kısa bir süre bekle (Socket exhaustion önlemi)
            await new Promise(r => setTimeout(r, 400));
        }
    },

    /**
     * Send a hex command and wait for response
     * TU cihazlar için sendTuCommand(), VX için doğrudan TCP kullanır.
     * @param {Uint8Array} command Raw bytes to send
     * @returns {Promise<Uint8Array>} Response bytes
     */
    async sendCommand(command) {
        if (this._clientId === null && this._connectedIp === null) {
            throw new Error('Not connected');
        }

        // TU serisi: her komut kendi bağlantısında çalışır
        if (this._deviceType === 'TU') {
            return this.sendTuCommand(command);
        }

        // H serisi: UDP JSON protokolü
        if (this._deviceType === 'H') {
            return this.sendHCommand(command);
        }

        // VX serisi: mevcut kalıcı bağlantıyı kullan
        if (this._clientId === null) throw new Error('Not connected');

        try {
            const binaryString = String.fromCharCode(...command);

            await TcpSocket.send({
                client: this._clientId,
                data: binaryString
            });

            console.log('[TCP] Data sent, reading response...');
            await new Promise(r => setTimeout(r, 200));

            const readResult = await TcpSocket.read({
                client: this._clientId,
                expectLen: 2048,
                timeout: 5
            });

            if (!readResult || !readResult.result) {
                return new Uint8Array(0);
            }

            const resBytes = new Uint8Array(readResult.result.length);
            for (let i = 0; i < readResult.result.length; i++) {
                resBytes[i] = readResult.result.charCodeAt(i);
            }

            return resBytes;
        } catch (err) {
            console.error('[TCP] Command failed:', err);
            throw err;
        }
    },

    /**
     * Disconnect from the device
     */
    async disconnect() {
        if (this._clientId !== null && this._deviceType === 'VX') {
            try {
                await TcpSocket.disconnect({ client: this._clientId });
                console.log('[TCP] Disconnected.');
            } catch (e) {
                console.warn('[TCP] Disconnect error:', e);
            }
        }
        
        // Temizle (VX veya TU her ikisi için de)
        this._clientId = null;
        this._connectedIp = null;
        this._connectedPort = null;
        this._deviceType = null;
    },

    /**
     * H Serisi: UDP Port 6000 üzerinden JSON komutu gönder ve yanıt bekle.
     * @param {Array|Object} command JSON formatlı komut nesnesi/dizisi
     * @returns {Promise<Object>} Yanıt nesnesi
     */
    /** Restart H Series device (W010A) */
    async restartH(deviceId = 0) {
        return this.sendHCommand({ cmd: 'W010A', deviceId, type: 0 });
    },

    /** Freeze/Unfreeze ALL layers on SCREEN (W040A). screenId:0, no deviceId per spec. */
    async setHFreezeScreen(enabled, screenId = 0) {
        return this.sendHCommand({ cmd: 'W040A', screenId, enable: enabled ? 1 : 0 });
    },

    /** Set Screen FTB (W0409). type: 0=FTB enabled, 1=FTB disabled */
    async setHFtb(enabled, deviceId = 0, screenId = 0) {
        return this.sendHCommand({ cmd: 'W0409', deviceId, screenId, type: enabled ? 0 : 1 });
    },

    /** Adjust Screen Brightness (W0410). brightness: 0-100 */
    async setHBrightness(brightness, deviceId = 0, screenId = 0) {
        return this.sendHCommand({ cmd: 'W0410', deviceId, screenId, brightness: Math.max(0, Math.min(100, Math.round(brightness))) });
    },

    /** Get screen preset list (R0600). Returns array of presets. */
    async getHPresets(deviceId = 0, screenId = 0) {
        return this.sendHCommand({ cmd: 'R0600', param0: deviceId, param1: screenId });
    },

    /** Load a specified preset (W0605). */
    async loadHPreset(presetId, deviceId = 0, screenId = 0) {
        return this.sendHCommand({ cmd: 'W0605', deviceId, screenId, presetId });
    },

    async sendHCommand(command) {
        if (!this._connectedIp) throw new Error('Not connected (no IP)');

        const commandArray = Array.isArray(command) ? command : [command];
        const payload = JSON.stringify(commandArray);
        const bufferBase64 = btoa(payload);

        let socketId = null;
        try {
            const createResult = await UdpSocket.create({ properties: { bufferSize: 65536 } });
            socketId = createResult.socketId;
            await UdpSocket.bind({ socketId, port: 0 });

            console.log(`[UDP-H] SEND to ${this._connectedIp}:6000 -> ${payload}`);

            const responsePromise = new Promise((resolve, reject) => {
                let accumulated = '';
                let silenceTimer = null;

                const tryParse = () => {
                    const cleaned = accumulated.replace(/\0/g, '').trim();
                    try {
                        const data = JSON.parse(cleaned);
                        console.log(`[UDP-H] RECV complete (${cleaned.length} chars) -> ${cleaned}`);
                        resolve(data);
                        return true;
                    } catch (e) {
                        return false; // not yet complete, keep accumulating
                    }
                };

                const globalTimeout = setTimeout(() => {
                    UdpSocket.removeAllListeners();
                    if (accumulated.length > 0) {
                        // Try one last time with what we have
                        const cleaned = accumulated.replace(/\0/g, '').trim();
                        try {
                            resolve(JSON.parse(cleaned));
                        } catch (e) {
                            reject(new Error('H Series UDP Timeout - incomplete JSON'));
                        }
                    } else {
                        reject(new Error('H Series UDP Timeout (no response)'));
                    }
                }, 3000);

                UdpSocket.addListener('receive', (info) => {
                    if (info.socketId !== socketId) return;
                    try {
                        const binaryString = atob(info.buffer);
                        const bytes = new Uint8Array(binaryString.length);
                        for (let i = 0; i < binaryString.length; i++) {
                            bytes[i] = binaryString.charCodeAt(i);
                        }
                        const chunk = new TextDecoder('utf-8').decode(bytes);
                        accumulated += chunk;
                        console.log(`[UDP-H] chunk received (${chunk.length} bytes, total: ${accumulated.length})`);

                        // Reset silence timer on each packet
                        if (silenceTimer) clearTimeout(silenceTimer);
                        silenceTimer = setTimeout(() => {
                            // No new packets for 300ms, try to parse what we have
                            if (tryParse()) {
                                clearTimeout(globalTimeout);
                                UdpSocket.removeAllListeners();
                            }
                        }, 300);

                        // Also try immediate parse in case it's already complete
                        if (tryParse()) {
                            clearTimeout(globalTimeout);
                            clearTimeout(silenceTimer);
                            UdpSocket.removeAllListeners();
                        }
                    } catch (e) {
                        console.error('[UDP-H] chunk error:', e.message);
                    }
                });
            });

            await UdpSocket.send({
                socketId,
                address: this._connectedIp,
                port: 6000,
                buffer: bufferBase64
            });

            return await responsePromise;
        } finally {
            if (socketId !== null) {
                try { await UdpSocket.close({ socketId }); } catch (e) { }
            }
        }
    },


    /**
     * Set Display Brightness (NovaStar Specific Protocol)
     * Command: 55 aa 00 00 fe ff 01 ff ff ff 01 00 01 00 00 02 01 00 XX SUM_L SUM_H
     * @param {number} value 0-255
     */
    async setBrightness(value) {
        // Ensure value is within 0-255 range
        const val = Math.max(0, Math.min(255, Math.round(value)));

        // Base command (19 bytes before checksum)
        const cmd = new Uint8Array([
            0x55, 0xaa, // Header
            0x00, 0x00, 0xfe, 0xff, 0x01, 0xff, 0xff, 0xff,
            0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x01, 0x00,
            val,        // XX (Brightness value)
            0x00, 0x00  // Placeholders for SUM_L, SUM_H
        ]);

        // Calculate Checksum: SUM = sum of bytes[2...18] + 0x5555
        let sumInternal = 0;
        for (let i = 2; i <= 18; i++) {
            sumInternal += cmd[i];
        }

        const totalSum = (sumInternal + 0x5555) & 0xFFFF;

        cmd[19] = totalSum & 0xff;        // SUM_L
        cmd[20] = (totalSum >> 8) & 0xff; // SUM_H

        console.log(`[TCP] Sending NovaStar Brightness command (${val}):`,
            Array.from(cmd).map(b => b.toString(16).padStart(2, '0')).join(' '));

        await this.sendCommand(cmd);
        return true;
    },

    /**
     * Load Preset (NovaStar Specific Protocol)
     * Command: 55 aa 00 00 fe 00 00 00 00 00 01 00 00 01 51 13 01 00 XX SUM_L SUM_H
     * @param {number} index 0-9 (representing preset 1-10)
     */
    async loadPreset(index) {
        // Ensure index is within 0x00-0x09 range
        const val = Math.max(0, Math.min(9, Math.round(index)));

        // Base command (19 bytes before checksum)
        const cmd = new Uint8Array([
            0x55, 0xaa, // Header
            0x00, 0x00, 0xfe, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x01, 0x00, 0x00, 0x01, 0x51, 0x13, 0x01, 0x00,
            val,        // XX (Preset index)
            0x00, 0x00  // Placeholders for SUM_L, SUM_H
        ]);

        // Calculate Checksum: SUM = sum of bytes[2...18] + 0x5555
        let sumInternal = 0;
        for (let i = 2; i <= 18; i++) {
            sumInternal += cmd[i];
        }

        const totalSum = (sumInternal + 0x5555) & 0xFFFF;

        cmd[19] = totalSum & 0xff;        // SUM_L
        cmd[20] = (totalSum >> 8) & 0xff; // SUM_H

        console.log(`[TCP] Sending NovaStar Preset Load command (${val + 1}):`,
            Array.from(cmd).map(b => b.toString(16).padStart(2, '0')).join(' '));

        await this.sendCommand(cmd);
        return true;
    },

    /**
     * Fade to Black (FTB / Blackout)
     * Command: 55 AA 00 00 FE FF 00 00 00 00 01 00 50 00 20 02 01 00 XX SUM_L SUM_H
     * @param {boolean} enabled 
     */
    async setBlackout(enabled) {
        const val = enabled ? 0x01 : 0x00;

        // Base command (19 bytes before checksum)
        const cmd = new Uint8Array([
            0x55, 0xaa, // Header
            0x00, 0x00, 0xfe, 0xff, 0x00, 0x00, 0x00, 0x00,
            0x01, 0x00, 0x50, 0x00, 0x20, 0x02, 0x01, 0x00,
            val,        // XX (0x01: Blackout, 0x00: Normal)
            0x00, 0x00  // Placeholders for SUM_L, SUM_H
        ]);

        // Calculate Checksum: SUM = sum of bytes[2...18] + 0x5555
        let sumInternal = 0;
        for (let i = 2; i <= 18; i++) {
            sumInternal += cmd[i];
        }

        const totalSum = (sumInternal + 0x5555) & 0xFFFF;

        cmd[19] = totalSum & 0xff;        // SUM_L
        cmd[20] = (totalSum >> 8) & 0xff; // SUM_H

        console.log(`[TCP] Sending FTB command (${enabled ? 'ENABLE' : 'DISABLE'}):`,
            Array.from(cmd).map(b => b.toString(16).padStart(2, '0')).join(' '));

        await this.sendCommand(cmd);
        return true;
    },

    /**
     * Freeze Screen
     * Command: 55 AA 00 00 FE FF 00 00 00 00 01 00 50 00 20 02 01 00 XX SUM_L SUM_H
     * @param {boolean} enabled 
     */
    async setFreeze(enabled) {
        const val = enabled ? 0x02 : 0x00;

        // Base command (19 bytes before checksum)
        const cmd = new Uint8Array([
            0x55, 0xaa, // Header
            0x00, 0x00, 0xfe, 0xff, 0x00, 0x00, 0x00, 0x00,
            0x01, 0x00, 0x50, 0x00, 0x20, 0x02, 0x01, 0x00,
            val,        // XX (0x02: Freeze, 0x00: Normal)
            0x00, 0x00  // Placeholders for SUM_L, SUM_H
        ]);

        // Calculate Checksum: SUM = sum of bytes[2...18] + 0x5555
        let sumInternal = 0;
        for (let i = 2; i <= 18; i++) {
            sumInternal += cmd[i];
        }

        const totalSum = (sumInternal + 0x5555) & 0xFFFF;

        cmd[19] = totalSum & 0xff;        // SUM_L
        cmd[20] = (totalSum >> 8) & 0xff; // SUM_H

        console.log(`[TCP] Sending Freeze command (${enabled ? 'ENABLE' : 'DISABLE'}):`,
            Array.from(cmd).map(b => b.toString(16).padStart(2, '0')).join(' '));

        await this.sendCommand(cmd);
        return true;
    },

    /**
     * Get Fan Status and Speeds
     * Command: 55 AA 00 00 FE 00 00 00 00 00 00 00 02 10 00 02 09 00 70 56
     * @returns {Promise<Array>} List of fan objects { index, state, speed }
     */
    async getFanStatus() {
        const cmd = new Uint8Array([
            0x55, 0xaa, 0x00, 0x00, 0xfe, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x02, 0x10, 0x00, 0x02,
            0x09, 0x00, 0x70, 0x56
        ]);

        const response = await this.sendCommand(cmd);
        if (response.length < 27) {
            console.warn('[TCP] Fan status response too short:', response.length);
            return [];
        }

        // Data starts at index 18
        // Fan 1: [18] state, [19] speedL, [20] speedH
        // Fan 2: [21] state, [22] speedL, [23] speedH
        // Fan 3: [24] state, [25] speedL, [26] speedH
        const fans = [];
        for (let i = 0; i < 3; i++) {
            const base = 18 + (i * 3);
            if (response.length > base + 2) {
                fans.push({
                    index: i + 1,
                    state: response[base], // 01: Active, 00: Inactive/Fixed
                    speed: response[base + 1] | (response[base + 2] << 8)
                });
            }
        }

        console.log('[TCP] Fan Status Parsed:', fans);
        return fans;
    },

    /**
     * Get Ethernet Port Backup Status
     * Queries 4 ranges: 1-4, 5-8, 9-16, 17-20
     * @returns {Promise<Array>} List of port objects { id, status }
     */
    async getPortBackupStatus() {
        const ranges = [
            { idStart: 1, addr: [0x18, 0x00, 0x00, 0x02], len: [0x04, 0x00], count: 4 },
            { idStart: 5, addr: [0x98, 0x00, 0x00, 0x02], len: [0x04, 0x00], count: 4 },
            { idStart: 9, addr: [0x00, 0x01, 0x00, 0x02], len: [0x08, 0x00], count: 8 },
            { idStart: 17, addr: [0x40, 0x00, 0x01, 0x02], len: [0x04, 0x00], count: 4 }
        ];

        const allPorts = [];

        for (const range of ranges) {
            const cmd = new Uint8Array([
                0x55, 0xaa, 0x00, 0x00, 0xfe, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00,
                ...range.addr, ...range.len,
                0x00, 0x00 // sum placeholders
            ]);

            // Checksum
            let sumVal = 0;
            // index 4 is 0xFE, index 12-17 are addr/len
            sumVal += 0xfe; // index 4
            for (let i = 12; i <= 17; i++) sumVal += cmd[i];
            const finalSum = (sumVal + 0x5555) & 0xFFFF;
            cmd[18] = finalSum & 0xFF;
            cmd[19] = (finalSum >> 8) & 0xFF;

            try {
                const resp = await this.sendCommand(cmd);
                if (resp && resp.length >= 18 + range.count) {
                    for (let i = 0; i < range.count; i++) {
                        allPorts.push({
                            id: range.idStart + i,
                            status: resp[18 + i] // 00: Primary, 01: Backup
                        });
                    }
                }
            } catch (err) {
                console.error(`[TCP] Error fetching port range ${range.idStart}:`, err);
            }
        }

        return allPorts;
    },

    /**
     * Restart Device
     * Command: 55 AA 00 00 FE FF 00 00 00 00 01 00 04 00 00 01 01 00 00 59 57
     */
    async restartDevice() {
        // Base command (19 bytes before checksum)
        const cmd = new Uint8Array([
            0x55, 0xaa, // Header
            0x00, 0x00, 0xfe, 0xff, 0x00, 0x00, 0x00, 0x00,
            0x01, 0x00, 0x04, 0x00, 0x00, 0x01, 0x01, 0x00,
            0x00,       // Padding/XX
            0x00, 0x00  // Placeholders for SUM_L, SUM_H
        ]);

        // Calculate Checksum: SUM = sum of bytes[2...18] + 0x5555
        let sumInternal = 0;
        for (let i = 2; i <= 18; i++) {
            sumInternal += cmd[i];
        }

        const totalSum = (sumInternal + 0x5555) & 0xFFFF;

        cmd[19] = totalSum & 0xff;        // SUM_L
        cmd[20] = (totalSum >> 8) & 0xff; // SUM_H

        console.log(`[TCP] Sending Restart command:`,
            Array.from(cmd).map(b => b.toString(16).padStart(2, '0')).join(' '));

        await this.sendCommand(cmd);
        return true;
    },

    /**
     * TU Series: Set Brightness (broadcast to all receiving cards)
     * Write: 55 AA 00 01 FC 00 01 FF FF FF 01 00 01 00 00 02 01 00 [VALUE] SUM_L SUM_H
     * @param {number} value 0-255
     */
    async setTuBrightness(value) {
        const val = Math.max(0, Math.min(255, Math.round(value)));

        const cmd = new Uint8Array([
            0x55, 0xaa,
            0x00, 0x01, 0xfc, 0x00, 0x01, 0xff,
            0xff, 0xff, 0x01, 0x00, 0x01, 0x00,
            0x00, 0x02, 0x01, 0x00,
            val,        // brightness value 0-255
            0x00, 0x00  // SUM_L, SUM_H
        ]);

        // Checksum: sum(bytes[2..18]) + 0x5555
        let sumInternal = 0;
        for (let i = 2; i <= 18; i++) sumInternal += cmd[i];
        const totalSum = (sumInternal + 0x5555) & 0xFFFF;
        cmd[19] = totalSum & 0xff;
        cmd[20] = (totalSum >> 8) & 0xff;

        console.log(`[TCP] TU setTuBrightness(${val}):`,
            Array.from(cmd).map(b => b.toString(16).padStart(2, '0')).join(' '));

        await this.sendCommand(cmd);
        return true;
    },

    /**

     * TU Series: Turn Screen On/Off
     * Write: 55 AA 00 01 FC 00 08 00 00 00 01 00 0D 00 00 00 01 00 [01:On/00:Off] SUM_L SUM_H
     * @param {boolean} enabled true = On, false = Off
     */
    async setScreen(enabled) {
        const val = enabled ? 0x01 : 0x00;

        const cmd = new Uint8Array([
            0x55, 0xaa,
            0x00, 0x01, 0xfc, 0x00, 0x08, 0x00,
            0x00, 0x00, 0x01, 0x00, 0x0d, 0x00,
            0x00, 0x00, 0x01, 0x00,
            val,        // 01: On, 00: Off
            0x00, 0x00  // SUM_L, SUM_H
        ]);

        // Checksum: sum(bytes[2..18]) + 0x5555  ← confirmed by desktop app logs
        let sumInternal = 0;
        for (let i = 2; i <= 18; i++) sumInternal += cmd[i];
        const totalSum = (sumInternal + 0x5555) & 0xFFFF;
        cmd[19] = totalSum & 0xff;
        cmd[20] = (totalSum >> 8) & 0xff;

        console.log(`[TCP] TU setScreen(${enabled ? 'ON' : 'OFF'}):`,
            Array.from(cmd).map(b => b.toString(16).padStart(2, '0')).join(' '));

        await this.sendCommand(cmd);
        return true;
    },

    /**
     * TU Series: Switch to a specified HDMI/Android source
     * Register 0x04: Source select
     * @param {number} sourceId  1=HDMI1, 2=HDMI2, 3=Android, 4=HDMI3
     */
    async setSource(sourceId) {
        const val = sourceId & 0xff;

        const cmd = new Uint8Array([
            0x55, 0xaa,
            0x00, 0x01, 0xfc, 0x00, 0x08, 0x00,
            0x00, 0x00, 0x01, 0x00, 0x04, 0x00,
            0x00, 0x00, 0x01, 0x00,
            val,        // 0:Android 1:HDMI1 2:HDMI2 3:HDMI3
            0x00, 0x00  // SUM_L, SUM_H
        ]);

        let sumInternal = 0;
        for (let i = 2; i <= 18; i++) sumInternal += cmd[i];
        const totalSum = (sumInternal + 0x5555) & 0xFFFF;
        cmd[19] = totalSum & 0xff;
        cmd[20] = (totalSum >> 8) & 0xff;

        const sourceNames = { 0: 'Android', 1: 'HDMI1', 2: 'HDMI2', 3: 'HDMI3' };
        console.log(`[TCP] TU setSource(${sourceNames[sourceId] || sourceId}):`,
            Array.from(cmd).map(b => b.toString(16).padStart(2, '0')).join(' '));

        await this.sendCommand(cmd);
        return true;
    },

    /**
     * TU Series: Set Absolute Volume
     * Device Type: 0x08, Register: 0x05
     * @param {number} value 0-100
     */
    async setTuVolume(value) {
        const val = Math.max(0, Math.min(100, Math.round(value)));

        const cmd = new Uint8Array([
            0x55, 0xaa,
            0x00, 0x01, 0xfc, 0x00, 0x08, 0x00,
            0x00, 0x00, 0x01, 0x00, 0x05, 0x00,
            0x00, 0x00, 0x01, 0x00,
            val,        // volume value 0-100
            0x00, 0x00  // SUM_L, SUM_H
        ]);

        let sumInternal = 0;
        for (let i = 2; i <= 18; i++) sumInternal += cmd[i];
        const totalSum = (sumInternal + 0x5555) & 0xFFFF;
        cmd[19] = totalSum & 0xff;
        cmd[20] = (totalSum >> 8) & 0xff;

        console.log(`[TCP] TU setTuVolume(${val}):`,
            Array.from(cmd).map(b => b.toString(16).padStart(2, '0')).join(' '));

        await this.sendCommand(cmd);
        return true;
    },

    /**
     * TU Series: Power Control
     * Device Type: 0x08, Register: 0x01=Standby, 0x02=WakeUp, 0x03=PowerOff
     * Write: 55 AA 00 01 FC 00 08 00 00 00 01 00 [REG] 00 00 00 01 00 00 SUM_L SUM_H
     * @param {'standby'|'wakeup'|'poweroff'} action
     */
    async powerControl(action) {
        const regMap = { standby: 0x01, wakeup: 0x02, poweroff: 0x03 };
        const reg = regMap[action];
        if (!reg) throw new Error(`Unknown power action: ${action}`);

        const cmd = new Uint8Array([
            0x55, 0xaa,
            0x00, 0x01, 0xfc, 0x00, 0x08, 0x00,
            0x00, 0x00, 0x01, 0x00, reg, 0x00,
            0x00, 0x00, 0x01, 0x00,
            0x00,       // data = 0x00
            0x00, 0x00  // SUM_L, SUM_H
        ]);

        let sumInternal = 0;
        for (let i = 2; i <= 18; i++) sumInternal += cmd[i];
        const totalSum = (sumInternal + 0x5555) & 0xFFFF;
        cmd[19] = totalSum & 0xff;
        cmd[20] = (totalSum >> 8) & 0xff;

        console.log(`[TCP] TU powerControl(${action}):`,
            Array.from(cmd).map(b => b.toString(16).padStart(2, '0')).join(' '));

        await this.sendCommand(cmd);
        return true;
    },

    /**
     * TU Series: Volume Control
     * Device Type: 0x07, Register: 0x06=VolumeUp, 0x07=VolumeDown
     * Write: 55 AA 00 01 FC 00 07 00 00 00 01 00 [REG] 00 00 00 01 00 00 SUM_L SUM_H
     * @param {'up'|'down'} direction
     */
    async volumeControl(direction) {
        const reg = direction === 'up' ? 0x06 : 0x07;

        const cmd = new Uint8Array([
            0x55, 0xaa,
            0x00, 0x01, 0xfc, 0x00, 0x07, 0x00,
            0x00, 0x00, 0x01, 0x00, reg, 0x00,
            0x00, 0x00, 0x01, 0x00,
            0x00,       // data = 0x00
            0x00, 0x00  // SUM_L, SUM_H
        ]);

        let sumInternal = 0;
        for (let i = 2; i <= 18; i++) sumInternal += cmd[i];
        const totalSum = (sumInternal + 0x5555) & 0xFFFF;
        cmd[19] = totalSum & 0xff;
        cmd[20] = (totalSum >> 8) & 0xff;

        console.log(`[TCP] TU volumeControl(${direction}):`,
            Array.from(cmd).map(b => b.toString(16).padStart(2, '0')).join(' '));

        await this.sendCommand(cmd);
        return true;
    },

    /**
     * TU Series: Remote Control Keys
     * Device Type: 0x07 — same frame structure as volumeControl
     * @param {string} key  home|back|menu|power|source|volup|voldown|up|down|left|right|ok
     */
    async remoteControl(key) {
        const regMap = {
            home:    0x01,
            back:    0x02,
            menu:    0x03,
            power:   0x04,
            source:  0x05,
            volup:   0x06,
            voldown: 0x07,
            up:      0x08,
            down:    0x09,
            left:    0x0A,
            right:   0x0B,
            ok:      0x0C,
        };
        const reg = regMap[key];
        if (reg === undefined) throw new Error(`Unknown remote key: ${key}`);

        const cmd = new Uint8Array([
            0x55, 0xaa,
            0x00, 0x01, 0xfc, 0x00, 0x07, 0x00,
            0x00, 0x00, 0x01, 0x00, reg,  0x00,
            0x00, 0x00, 0x01, 0x00,
            0x00,       // data = 0x00
            0x00, 0x00  // SUM_L, SUM_H
        ]);

        let sum = 0;
        for (let i = 2; i <= 18; i++) sum += cmd[i];
        const totalSum = (sum + 0x5555) & 0xFFFF;
        cmd[19] = totalSum & 0xff;
        cmd[20] = (totalSum >> 8) & 0xff;

        console.log(`[TCP] TU remoteControl(${key}):`,
            Array.from(cmd).map(b => b.toString(16).padStart(2, '0')).join(' '));

        await this.sendCommand(cmd);
        return true;
    },

    /**
     * TU Series: Read Status Registers (Device Type 0x06)
     * Reads registers 0x01 through 0x0D for various device statuses.
     * @param {number} reg The register to read (e.g., 0x01 for USB Drive)
     * @returns {Promise<Object|null>} Parsed status object or null if failed
     */
    async readTuStatus(reg) {
        if (!this._connectedIp || this._deviceType !== 'TU') return null;

        const cmd = new Uint8Array([
            0x55, 0xaa,
            0x00, 0x01, 0xfc, 0x00, 0x06, 0x00, // Device Type 0x06 (Monitoring)
            0x00, 0x00, 0x00, 0x00, reg,  0x00, // Read command: 0x00 for read, reg for register
            0x00, 0x00, 0x01, 0x00,
            0x00, 0x00  // SUM_L, SUM_H
        ]);

        let sum = 0;
        for (let i = 2; i <= 17; i++) sum += cmd[i];
        const totalSum = (sum + 0x5555) & 0xFFFF;
        cmd[18] = totalSum & 0xff;
        cmd[19] = (totalSum >> 8) & 0xff;

        try {
            const resBytes = await this.sendTuCommand(cmd);
            return this.parseTuStatus(resBytes, reg);
        } catch (err) {
            console.error(`[TCP] Failed to read TU status reg 0x${reg.toString(16)}:`, err);
            return null;
        }
    },

    /**
     * Parses the response byte array for a given TU status register.
     * According to protocol, response header is AA 55.
     * Data length is usually at index 16..17, data starts at index 18.
     */
    parseTuStatus(res, reg) {
        if (!res || res.length < 20 || res[0] !== 0xaa || res[1] !== 0x55) return null;

        // Common offsets for TU Response:
        // 0-1: AA 55, 6: DeviceType (06), 12: Reg, 16-17: DataLen, 18.. : Data
        const dlen = res[16] | (res[17] << 8);
        if (dlen === 0 || res.length < 18 + dlen + 2) return null; // Need data + checksum

        const data = res.slice(18, 18 + dlen);

        switch (reg) {
            case 0x01: // USB Drive Status
                return { type: 'usb', inserted: data[0] === 0x01 };

            case 0x02: // HDMI Status
                if (data.length >= 4) {
                    return {
                        type: 'hdmi_status',
                        hdmi1: data[0] === 0x01,
                        hdmi2: data[1] === 0x01,
                        android: data[2] === 0x01,
                        hdmi3: data[3] === 0x01,
                    };
                }
                break;

            case 0x03: // Screen Mirroring Count
                return { type: 'screen_mirror_count', count: data[0] };

            case 0x04: // Current Source
                const sources = { 0: 'Android', 1: 'HDMI1', 2: 'HDMI2', 3: 'HDMI3' };
                return { type: 'current_source', source: sources[data[0]] || 'Unknown' };

            case 0x05: // System Volume
                if (data.length >= 2) {
                    return {
                        type: 'volume',
                        muted: data[0] === 0x01,
                        volume: data[1] // decimal volume 0-100
                    };
                }
                break;

            case 0x06: // Wi-Fi Status
                if (data.length >= 3) {
                    const statuses = { 0: 'Unknown', 1: 'Off', 2: 'On', 3: 'Turning Off', 4: 'Turning On' };
                    return {
                        type: 'wifi',
                        status: statuses[data[0]] || 'Unknown',
                        connected: data[1] === 0x01,
                        signalStrength: -Math.abs(data[2])
                    };
                }
                break;

            case 0x07: // Wired Network
                return { type: 'wired_network', connected: data[0] === 0x01 };

            case 0x08: // Hotspot
                if (data.length >= 3) {
                    if (data[0] === 0xFF) return { type: 'hotspot', error: true };
                    const bands = { 1: '2.4GHz', 2: '5GHz', 3: 'Auto' };
                    return {
                        type: 'hotspot',
                        on: data[0] === 0x01,
                        band: bands[data[1]] || 'Unknown',
                        channel: data[2] === 0x00 ? 'Auto' : data[2]
                    };
                }
                break;

            case 0x09: // Bluetooth
                if (data.length >= 2) {
                    const statuses = { 0: 'Off', 1: 'Turning On', 2: 'On', 3: 'Turning Off' };
                    const discoverability = { 0: 'Hidden', 1: 'Paired Only', 2: 'Discoverable' };
                    return {
                        type: 'bluetooth',
                        status: statuses[data[0]] || 'Unknown',
                        discoverability: discoverability[data[1]] || 'Unknown'
                    };
                }
                break;

            case 0x0A: // Screen Mirroring Activation
                const mirrorStatuses = { 0x00: 'Not Activated', 0x01: 'Trial', 0x02: 'Commercial', 0xFF: 'Service Error' };
                return { type: 'screen_mirror_activation', status: mirrorStatuses[data[0]] || 'Unknown' };

            case 0x0B: // System Mute Status
                return { type: 'mute_status', muted: data[0] === 0x01 };

            case 0x0C: // Wired Network DHCP
                return { type: 'wired_dhcp', isDhcp: data[0] === 0x01 };

            case 0x0D: // System Status
                const sysStatuses = { 0x00: 'Standby', 0x01: 'Normal', 0xFF: 'POWER Service Failed' };
                return { type: 'system_status', status: sysStatuses[data[0]] || 'Unknown' };
        }
        return null;
    },

    /**
     * Reads TU Ethernet Link Status for ports 1-20.
     * Uses 3 separate read commands as specified in the protocol.
     * Returns an object: { ports: boolean[20] } where ports[0] = port 1, ports[19] = port 20.
     * Protocol:
     *   Ports 1-8:  Read reg 0x2A  (3 data bytes: [2]=byte for ports1-8)
     *   Ports 9-16: Read reg 0x2D  (3 data bytes: [1]=byte for ports9-16)
     *   Ports 17-20: Read reg 0x3F (3 data bytes: [0]=byte for ports17-20)
     */
    async readTuLinkStatus() {
        if (!this._connectedIp || this._deviceType !== 'TU') return null;

        // Build command for each register
        const buildCmd = (reg) => {
            // 55 AA 00 01 FC 00 00 00 00 00 00 00 <reg> 00 00 00 03 00 <SUM_L> <SUM_H>
            const cmd = new Uint8Array([
                0x55, 0xaa,
                0x00, 0x01, 0xfc, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                reg, 0x00, 0x00, 0x00,
                0x03, 0x00,
                0x00, 0x00  // SUM_L, SUM_H
            ]);
            let sum = 0;
            for (let i = 2; i <= 17; i++) sum += cmd[i];
            const totalSum = (sum + 0x5555) & 0xFFFF;
            cmd[18] = totalSum & 0xff;
            cmd[19] = (totalSum >> 8) & 0xff;
            return cmd;
        };

        const parseLinkResponse = (res) => {
            if (!res || res.length < 22 || res[0] !== 0xaa || res[1] !== 0x55) return null;
            const dlen = res[16] | (res[17] << 8);
            if (dlen < 3 || res.length < 18 + dlen) return null;
            // Data is  3 bytes: [byte_17_20, byte_9_16, byte_1_8]
            return { b0: res[18], b1: res[19], b2: res[20] };
        };

        try {
            // Single command with all 3 groups in data
            const res = await this.sendTuCommand(buildCmd(0x2A));
            const parsed = parseLinkResponse(res);

            // If single command returns all 3 bytes, use them
            // Otherwise try individual queries
            if (parsed && (parsed.b0 !== 0 || parsed.b1 !== 0 || parsed.b2 !== 0 || res.length >= 21)) {
                const ports = new Array(20).fill(false);
                // Ports 1-8: byte[2] (LSB=port1)
                for (let i = 0; i < 8; i++) ports[i] = ((parsed.b2 >> i) & 1) === 1;
                // Ports 9-16: byte[1] (LSB=port9)
                for (let i = 0; i < 8; i++) ports[8 + i] = ((parsed.b1 >> i) & 1) === 1;
                // Ports 17-20: byte[0] (LSB=port17)
                for (let i = 0; i < 4; i++) ports[16 + i] = ((parsed.b0 >> i) & 1) === 1;
                return { ports };
            }
        } catch (err) {
            console.error('[TU] readTuLinkStatus error:', err);
        }
        return null;
    },

    /**
     * Reads TU Receiving Card Hardware Status (Brightness, Voltage, Temperature)
     * Queries Ethernet port 1 of the sending card (Dest D_Mac: 0x01)
     */
    async readTuHardwareStatus() {
        if (!this._connectedIp || this._deviceType !== 'TU') return null;

        const buildCmd = (addrByte0, addrByte3) => {
            const cmd = new Uint8Array([
                0x55, 0xaa,
                0x00, 0x01, 0xfc, 0x00,
                0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
                addrByte0, 0x00, 0x00, addrByte3,
                0x01, 0x00,
                0x00, 0x00
            ]);
            let sum = 0;
            for (let i = 2; i <= 17; i++) sum += cmd[i];
            const totalSum = (sum + 0x5555) & 0xFFFF;
            cmd[18] = totalSum & 0xff;
            cmd[19] = (totalSum >> 8) & 0xff;
            return cmd;
        };

        const extractData = (res) => {
            if (!res || res.length < 20 || res[0] !== 0xaa || res[1] !== 0x55) return null;
            const dlen = res[16] | (res[17] << 8);
            if (dlen < 1 || res.length < 18 + dlen) return null;
            return res[18];
        };

        try {
            // Brightness: 01 00 00 02 (Addr0=0x01, Addr3=0x02)
            const resB = await this.sendTuCommand(buildCmd(0x01, 0x02));
            // Voltage: 03 00 00 0A (Addr0=0x03, Addr3=0x0A)
            const resV = await this.sendTuCommand(buildCmd(0x03, 0x0a));
            // Temp: 01 00 00 0A (Addr0=0x01, Addr3=0x0A)
            const resT = await this.sendTuCommand(buildCmd(0x01, 0x0a));

            const bData = extractData(resB);
            const vData = extractData(resV);
            const tData = extractData(resT);

            const status = {};
            if (bData !== null) status.brightness = bData; 
            if (vData !== null) status.voltage = ((vData & 0x7F) * 0.1).toFixed(1);
            if (tData !== null) status.temperature = (tData * 0.5).toFixed(1);

            return status;
        } catch (err) {
            console.error('[TU] readTuHardwareStatus error:', err);
        }
        return null;
    },

    /**
     * Specific: Read ModeID (TCP Search)
     */
    async readModeId(ip) {
        // Try VXPro first (15200)
        try {
            console.log(`[TCP] Probing ${ip}:15200 (VXPro)...`);
            await this.connect(ip, 15200);
            const cmd = new Uint8Array([
                0x55, 0xaa, 0x00, 0x00, 0xfe, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00,
                0x02, 0x00, 0x57, 0x56
            ]);
            await this.sendCommand(cmd);
            return {
                ip: ip,
                port: 15200,
                SN: 'TCP-' + ip.split('.').pop(),
                deviceName: 'VXPro (TCP)',
                isVerified: true,
                type: 'VX'
            };
        } catch (vxErr) {
            console.log(`[TCP] VXPro probe failed on ${ip}:15200, trying TU Series (5201)...`);

            // Try TU Series (5201)
            try {
                await this.connect(ip, 5201);
                // TU Series uses AA 55 header.
                return {
                    ip: ip,
                    port: 5201,
                    SN: 'TU-' + ip.split('.').pop(),
                    deviceName: 'TU Series (TCP)',
                    isVerified: true,
                    type: 'TU'
                };
            } catch (tuErr) {
                console.error(`[TCP] All probes failed for ${ip}`);
                throw new Error('Device not found on known ports (15200, 5201)');
            }
        }
    }
};
