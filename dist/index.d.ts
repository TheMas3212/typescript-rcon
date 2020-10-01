/// <reference types="node" />
import { Duplex } from 'stream';
import { EventEmitter } from 'events';
declare type TCPConnectorOptions = {
    type: 'tcp';
    password: string;
    reconnect?: boolean;
    host: string;
    port: number;
};
declare type CustomConnectorOptions = {
    type: 'custom';
    password: string;
    reconnect?: boolean;
    createDuplex: () => Duplex | Promise<Duplex>;
};
export declare type ConnectionOptions = TCPConnectorOptions | CustomConnectorOptions;
interface IRCon {
    on(event: "auth", listener: (status: boolean) => void): this;
    on(event: "error", listener: (e: Error) => void): this;
}
export declare class RCon extends EventEmitter implements IRCon {
    private stream;
    private options;
    private idCounter;
    private partialPacket;
    private bufferedPackets;
    constructor(opts: ConnectionOptions);
    connect(): RCon;
    disconnect(): void;
    reconnect(): void;
    setReconnect(state: boolean): void;
    runCommand(command: string): Promise<string>;
    private readData;
    private parsePacket;
    private buildPacket;
    private sendPacket;
    private sendServerDataAuth;
    private sendServerExecCommand;
    private authenticate;
    private streamError;
    private generateID;
}
export declare class RConREPL {
    private rcon;
    private cli;
    private connected;
    constructor(opts: ConnectionOptions);
}
export {};
