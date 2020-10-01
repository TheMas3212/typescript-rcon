"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RConREPL = exports.RCon = void 0;
const net_1 = require("net");
const repl_1 = require("repl");
const events_1 = require("events");
class RCon extends events_1.EventEmitter {
    constructor(opts) {
        var _a;
        switch (opts.type) {
            case 'tcp': {
                if (!opts.host)
                    throw new Error('Missing host');
                if (!opts.port)
                    throw new Error('Missing port');
                break;
            }
            case 'custom': {
                if (!opts.createDuplex)
                    throw new Error('Missing createDuplex Method');
                break;
            }
            default: {
                throw new Error('Invalid Options for Rcon');
            }
        }
        super();
        this.options = opts;
        this.options.reconnect = (_a = this.options.reconnect) !== null && _a !== void 0 ? _a : true;
        this.on('auth', (success) => {
            if (!success) {
                this.options.reconnect = false;
                this.disconnect();
                throw new Error('Password Rejected');
            }
        });
    }
    connect() {
        this.bufferedPackets = [];
        switch (this.options.type) {
            case 'tcp': {
                const socket = net_1.createConnection({
                    port: this.options.port,
                    host: this.options.host
                });
                this.stream = socket;
                socket.on('connect', this.authenticate.bind(this));
                socket.on('error', this.streamError.bind(this));
                socket.on('close', this.reconnect.bind(this));
                socket.on('readable', this.readData.bind(this));
                break;
            }
            case 'custom': {
                Promise.resolve(this.options.createDuplex()).then((socket) => {
                    this.stream = socket;
                    socket.on('error', this.streamError.bind(this));
                    socket.on('end', this.reconnect.bind(this));
                    socket.on('readable', this.readData.bind(this));
                    this.authenticate();
                });
                break;
            }
            default: {
                throw new Error('Invalid Options for Rcon');
            }
        }
        return this;
    }
    disconnect() {
        this.stream.end();
    }
    reconnect() {
        if (this.options.reconnect) {
            this.disconnect();
            setTimeout(this.connect.bind(this), 300);
        }
        ;
    }
    ;
    setReconnect(state) {
        this.options.reconnect = state;
    }
    runCommand(command) {
        return this.sendServerExecCommand(command);
    }
    readData() {
        var _a;
        const packet = (_a = this.partialPacket) !== null && _a !== void 0 ? _a : {};
        if (packet.size === undefined) {
            const buff = this.stream.read(4);
            if (buff === null)
                return;
            packet.size = buff.readInt32LE();
            packet.buffer = Buffer.allocUnsafe(packet.size + 4);
            packet.buffer.writeInt32LE(packet.size, 0);
            packet.buffer.fill(0x00, packet.size + 2);
        }
        const buff = this.stream.read(packet.size);
        packet.id = buff.readInt32LE(0);
        packet.buffer.writeInt32LE(packet.id, 4);
        packet.type = buff.readInt32LE(4);
        packet.buffer.writeInt32LE(packet.type, 8);
        packet.body = buff.toString('utf8', 8, buff.length - 2);
        buff.write(packet.body, 8);
        this.parsePacket(packet);
        this.partialPacket = null;
    }
    parsePacket(packet) {
        switch (packet.type) {
            case 0: {
                if (packet.body === 'Unknown request 9' && this.bufferedPackets.length > 0) {
                    const responce = this.bufferedPackets.reduce((a, c) => { return a + c.body; }, '');
                    this.emit(`id-${this.bufferedPackets[0].id}`, responce);
                    this.bufferedPackets = [];
                }
                else {
                    this.bufferedPackets.push(packet);
                }
                break;
            }
            case 2: {
                this.emit('auth', !(packet.id === -1));
                break;
            }
            default: {
                throw new Error('Received Unknown Packet Type');
            }
        }
    }
    buildPacket(type, body) {
        body = body.toString();
        const size = 10 + body.length;
        const id = this.generateID();
        const buffer = Buffer.allocUnsafe(size + 4);
        buffer.writeInt32LE(size, 0);
        buffer.writeInt32LE(id, 4);
        buffer.writeInt32LE(type, 8);
        buffer.write(body, 12);
        buffer.fill(0x00, size + 2);
        return {
            size: size,
            id: id,
            type: type,
            body: body,
            buffer: buffer
        };
    }
    sendPacket(packet) {
        this.stream.write(packet.buffer);
    }
    sendServerDataAuth() {
        const packet = this.buildPacket(3, this.options.password);
        this.sendPacket(packet);
    }
    sendServerExecCommand(command) {
        return new Promise((resolve, reject) => {
            const packet = this.buildPacket(2, Buffer.from(command));
            this.sendPacket(packet);
            const packet2 = this.buildPacket(9, Buffer.allocUnsafe(0));
            this.sendPacket(packet2);
            this.once(`id-${packet.id}`, resolve);
        });
    }
    authenticate() {
        this.sendServerDataAuth();
    }
    ;
    streamError(e) {
        this.emit('error', e);
    }
    ;
    generateID() {
        var _a;
        const i = (_a = this.idCounter) !== null && _a !== void 0 ? _a : 0;
        this.idCounter = i + 1;
        if (this.idCounter >= 2147483647)
            this.idCounter = 0;
        return i;
    }
}
exports.RCon = RCon;
class RConREPL {
    constructor(opts) {
        this.rcon = new RCon(opts);
        this.cli = repl_1.start({
            useGlobal: true,
        });
        this.rcon.connect();
        this.rcon.on('error', (error) => {
            if (error.code === 'ECONNREFUSED') {
                if (this.connected)
                    console.log('Connection Lost');
                this.connected = false;
            }
            else
                throw error;
        });
        this.rcon.on('auth', () => {
            this.connected = true;
            console.log('Connected');
        });
        this.cli.defineCommand('r', (cmd) => {
            this.rcon.runCommand(cmd).then((result) => {
                if (result)
                    console.log('>', result);
            });
        });
        this.cli.defineCommand('d', () => {
            this.rcon.setReconnect(false);
            this.rcon.disconnect();
        });
        this.cli.defineCommand('c', () => {
            this.rcon.setReconnect(true);
            this.rcon.connect();
        });
        this.cli.defineCommand('q', () => {
            this.rcon.setReconnect(false);
            this.rcon.disconnect();
            this.cli.close();
        });
    }
}
exports.RConREPL = RConREPL;
//# sourceMappingURL=index.js.map