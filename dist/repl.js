"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("./index");
const [host, port, password] = [process.argv[2], parseInt(process.argv[3]), process.argv[4]];
const cli = new index_1.RConREPL({
    type: 'tcp',
    host, port, password
});
//# sourceMappingURL=repl.js.map