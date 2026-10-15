import net from 'node:net';
// Inherited by worker processes. Production is unaffected; tests fail closed at dispatch.
if(process.env.STUDIO_TEST_BLOCK_EXTERNAL==='1'&&!net.Socket.prototype.connect.studioGuard){
  const original=net.Socket.prototype.connect;
  const guarded=function(...args){const options=net._normalizeArgs(args)[0],host=options.host||'localhost';if(options.port&&!['127.0.0.1','::1','localhost'].includes(host))throw new Error('[TEST_NETWORK_BLOCK] External socket denied');return original.apply(this,args);};
  guarded.studioGuard=true;net.Socket.prototype.connect=guarded;
}
