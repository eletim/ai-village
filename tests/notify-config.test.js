import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
test('Notify configuration preserves existing credentials, quotes replacement input and writes mode 600',()=>{
 execFileSync('python3',['-B','-c',`
import importlib.util,tempfile,pathlib,os,subprocess
spec=importlib.util.spec_from_file_location('configure','scripts/configure-notify.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
 p=pathlib.Path(d)/'config'
 original="export NOTIFY_TOKEN='synthetic-test-only'\\n"
 p.write_text(original+"NOTIFY_SERVER='old'\\nNOTIFY_TOPIC='old'\\nOTHER=keep\\n")
 m.configure(p)
 assert original in p.read_text()
 assert "https://eletim.jp/ntfy" in p.read_text()
 assert "NOTIFY_TOPIC=topic-eletim" in p.read_text()
 assert p.stat().st_mode & 0o777 == 0o600
 assert 'OTHER=keep' in p.read_text()
 m.configure(p, "synthetic'$(false)")
 subprocess.run(['bash','-c','source "$1"; test "$NOTIFY_TOKEN" = "$2"','bash',str(p),"synthetic'$(false)"],check=True)
 try:m.configure(p,'')
 except ValueError:pass
 else:raise AssertionError('empty replacement accepted')
 fresh=pathlib.Path(d)/'fresh'
 m.configure(fresh)
 assert "NOTIFY_TOKEN=''" in fresh.read_text()
 result=subprocess.run(['python3','scripts/configure-notify.py','--config',str(fresh),'--set-token'],input='',capture_output=True,text=True)
 assert result.returncode==1
 assert "NOTIFY_TOKEN=''" in fresh.read_text()
`],{stdio:'pipe'});
});
