/**
 * Socket Service Stub
 */

let io = null;

module.exports = {
  init: (server) => {
    console.log('📡 Socket service initialized (stub)');
    return io;
  },
  getIO: () => io,
  io: io,
  emit: (event, data) => {
    console.log(`📡 Socket emit: ${event}`, data);
  }
};
