import { networkInterfaces } from 'node:os';
export const tailnetAddress = value => /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.(?:\d{1,3})\.(?:\d{1,3})$/.test(value || '') && value.split('.').every(n=>Number(n)<256);
export function listenAddresses({host='127.0.0.1',vpnAddress=process.env.VILLAGE_VPN_ADDRESS,interfaces=networkInterfaces()}={}) {
  const assigned=Object.values(interfaces).flat().filter(a=>a.family==='IPv4'&&!a.internal).map(a=>a.address);
  if(host==='0.0.0.0'&&!vpnAddress){const candidates=assigned.filter(tailnetAddress);if(candidates.length!==1)throw new Error('VPNアドレスを一意に確認できません。VILLAGE_VPN_ADDRESSに割当済みのTailscale IPv4を指定してください。');vpnAddress=candidates[0];}
  if(tailnetAddress(host)){vpnAddress ||= host;host='127.0.0.1';}
  if(!['127.0.0.1','::1','0.0.0.0'].includes(host))throw new Error('localhostまたは割当済みのVPNアドレスを指定してください。');
  if(vpnAddress&&(!tailnetAddress(vpnAddress)||!assigned.includes(vpnAddress)))throw new Error('VILLAGE_VPN_ADDRESSはこのPCに割当済みのTailscale IPv4である必要があります。');
  return [...new Set([host==='0.0.0.0'?'127.0.0.1':host,...(vpnAddress?[vpnAddress]:[])])];
}
