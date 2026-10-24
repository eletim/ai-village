import test from 'node:test';import assert from 'node:assert/strict';import {listenAddresses,tailnetAddress}from'../server/network.mjs';
const interfaces={eth0:[{family:'IPv4',internal:false,address:'100.78.154.38'}],eth1:[{family:'IPv4',internal:false,address:'192.168.11.5'}]};
test('legacy wildcard startup binds loopback and assigned VPN address, never LAN or wildcard',()=>{
 assert.deepEqual(listenAddresses({host:'0.0.0.0',interfaces}),['127.0.0.1','100.78.154.38']);
 assert.deepEqual(listenAddresses({host:'127.0.0.1',vpnAddress:'100.78.154.38',interfaces}),['127.0.0.1','100.78.154.38']);
 assert.deepEqual(listenAddresses({host:'100.78.154.38',interfaces}),['127.0.0.1','100.78.154.38']);
});
test('local startup stays local and VPN discovery refuses ambiguity or unassigned addresses',()=>{
 assert.deepEqual(listenAddresses({host:'127.0.0.1',interfaces}),['127.0.0.1']);
 assert.throws(()=>listenAddresses({host:'0.0.0.0',interfaces:{}}));
 assert.throws(()=>listenAddresses({host:'0.0.0.0',interfaces:{eth0:[...interfaces.eth0,{family:'IPv4',address:'100.80.1.1'}]}}));
 assert.throws(()=>listenAddresses({host:'127.0.0.1',vpnAddress:'100.80.1.1',interfaces}));
 assert.throws(()=>listenAddresses({host:'192.168.11.5',interfaces}));
 for(const ip of ['100.63.0.1','100.128.0.1','100.78.999.1','192.168.11.5'])assert.equal(tailnetAddress(ip),false);
});
