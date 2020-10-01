import { createConnection } from 'net';
import { start, REPLServer } from 'repl';
import { Duplex } from 'stream';
import { EventEmitter } from 'events';

type TCPConnectorOptions = {
  type: 'tcp';
  password: string;
  reconnect?: boolean;
  host: string;
  port: number;
};
type CustomConnectorOptions = {
  type: 'custom';
  password: string;
  reconnect?: boolean;
  createDuplex: () => Duplex | Promise<Duplex>;
};

export type ConnectionOptions = TCPConnectorOptions | CustomConnectorOptions;
type Packet = {
  size?: number;
  id?: number;
  type?: number;
  body?: string;
  buffer?: Buffer;
};
interface IRCon {
  on(event: "auth", listener: (status: boolean) => void): this;
  on(event: "error", listener: (e: Error) => void): this;
}

export class RCon extends EventEmitter implements IRCon {
  private stream: Duplex;
  private options: ConnectionOptions;
  private idCounter: number;
  private partialPacket: Packet;
  private bufferedPackets: Packet[];
  constructor(opts: ConnectionOptions) {
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
    this.options.reconnect = this.options.reconnect ?? true;
    this.on('auth', (success) => {
      if (!success) {
        this.options.reconnect = false;
        this.disconnect();
        throw new Error('Password Rejected');
      }
    });
  }
  public connect(): RCon {
    this.bufferedPackets = [];
    switch (this.options.type) {
      case 'tcp': {
        const socket = createConnection({
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
  public disconnect() {
    this.stream.end();
  }
  public reconnect() {
    if (this.options.reconnect) {
      this.disconnect();
      setTimeout(this.connect.bind(this), 300);
    };
  };
  public setReconnect(state: boolean) {
    this.options.reconnect = state;
  }

  public runCommand(command: string): Promise<string> {
    return this.sendServerExecCommand(command);
  }

  private readData() {
    const packet: Packet = this.partialPacket ?? {};
    if (packet.size === undefined) {
      const buff: Buffer = this.stream.read(4);
      if (buff === null)
        return;
      packet.size = buff.readInt32LE();
      packet.buffer = Buffer.allocUnsafe(packet.size + 4);
      packet.buffer.writeInt32LE(packet.size, 0);
      packet.buffer.fill(0x00, packet.size + 2);
    }
    const buff: Buffer = this.stream.read(packet.size);
    packet.id = buff.readInt32LE(0);
    packet.buffer.writeInt32LE(packet.id, 4);
    packet.type = buff.readInt32LE(4);
    packet.buffer.writeInt32LE(packet.type, 8);
    packet.body = buff.toString('utf8', 8, buff.length - 2);
    buff.write(packet.body, 8);
    this.parsePacket(packet);
    this.partialPacket = null;
  }
  private parsePacket(packet: Packet) {
    switch (packet.type) {
      case 0: {
        if (packet.body === 'Unknown request 9' && this.bufferedPackets.length > 0) {
          const responce = this.bufferedPackets.reduce((a, c) => { return a + c.body; }, '');
          this.emit(`id-${this.bufferedPackets[0].id}`, responce);
          this.bufferedPackets = [];
        } else {
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

  private buildPacket(type: number, body: string | Buffer) {
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

  private sendPacket(packet) {
    this.stream.write(packet.buffer);
  }
  private sendServerDataAuth() {
    const packet = this.buildPacket(3, this.options.password);
    this.sendPacket(packet);
  }
  private sendServerExecCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const packet = this.buildPacket(2, Buffer.from(command));
      this.sendPacket(packet);
      const packet2 = this.buildPacket(9, Buffer.allocUnsafe(0));
      this.sendPacket(packet2);
      this.once(`id-${packet.id}`, resolve);
    });
  }

  private authenticate() {
    this.sendServerDataAuth();
  };
  private streamError(e: Error) {
    this.emit('error', e);
  };

  private generateID(): number {
    const i = this.idCounter ?? 0;
    this.idCounter = i + 1;
    if (this.idCounter >= 2147483647)
      this.idCounter = 0;
    return i;
  }
}

export class RConREPL {
  private rcon: RCon;
  private cli: REPLServer;
  private connected: boolean;
  constructor(opts: ConnectionOptions) {
    this.rcon = new RCon(opts);
    this.cli = start({
      useGlobal: true,
    });
    this.rcon.connect();
    this.rcon.on('error', (error) => {
      if (error.code === 'ECONNREFUSED') {
        if (this.connected) console.log('Connection Lost');
        this.connected = false;
      } else throw error;
    });
    this.rcon.on('auth', () => {
      this.connected = true;
      console.log('Connected');
    });
    this.cli.defineCommand('r', (cmd) => {
      this.rcon.runCommand(cmd).then((result) => {
        if (result) console.log('>', result);
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