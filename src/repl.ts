import { RCon, RConREPL } from './index';

const [host, port, password] = [process.argv[2], parseInt(process.argv[3]), process.argv[4]];

const cli = new RConREPL({
  type: 'tcp',
  host, port, password
});