// Invalidations carry no request content. Reconnection always announces a fresh
// snapshot, so history retention and stream replay are independent.
export class ChangeStream {
 constructor(events){this.clients=new Set();this.version=0;events.on('change',()=>{this.version++;for(const res of this.clients)this.send(res);});}
 send(res){if(res.writableLength>65536){res.destroy();return;}res.write('data: '+JSON.stringify({version:this.version})+'\n\n');}
 connect(req,res){
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
  res.write('retry: 3000\n\n');this.clients.add(res);this.send(res);
  const timer=setInterval(()=>{if(res.writableLength>65536)res.destroy();else res.write(': heartbeat\n\n');},30000);timer.unref();
  res.on('close',()=>{clearInterval(timer);this.clients.delete(res);});
 }
}
