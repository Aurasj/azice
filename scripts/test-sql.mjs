// Fresh in-memory PGlite only. Never starts a native/hosted database or HTTP client.
import {execFileSync} from 'node:child_process';
const runners=['activity-unread','activity','friendship-helper','post-cleanup','push','push-without-quiet-hours','username-friends','daily-posting'];
for(const name of runners)execFileSync(process.execPath,['scripts/test-'+name+'-postgres.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/test-activity-postgres.mjs'],{stdio:'inherit',env:{...process.env,AZICE_ACTIVITY_NO_CRON:'1'}});
