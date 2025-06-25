import { AriClient } from '@ipcom/asterisk-ari';

const client = new AriClient({
  host: '127.0.0.1',
  port: 8088,
  username: process.env.ASTERISK_USERNAME || 'admin',
  password: process.env.ASTERISK_PASSWORD || 'password',
});

export default client;