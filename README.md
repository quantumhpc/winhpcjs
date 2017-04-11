# nodejs-winhpcjs
Nodejs command wrapper for Windows HPC Cluster Manager

## Introduction
Submit job to a Windows HPC server from a nodejs application and retrieve files from a working directory.

For now only basic function are implemented: **job list**, **job submit**, **job cancel(jobId)**, **nodes list** and only support local installation.

### Caveat
Job's owner is the user running the nodejs process (usually an administrator) thus the info retrieve by `job list` always show the same username. 
Further modifications will come to get the correct owner on the job.
* See the **winhpc_agents** branch for a possible workaroung

## Basic usage
Edit `./config/winhpcserver.json"` with your information
```
var win_config = {
        "method"                : "local",
        "sshExec"               : "C:\\Program Files (x86)\\PuTTY\\plink.exe",
        "scpExec"               : "C:\\Program Files (x86)\\PuTTY\\pscp.exe",
        "username"              : "user",
        "domain"                : "DOMAIN",
        "serverName"            : "winserver",
        "secretAccessKey"       : "C:\\Users\\User\\.ssh\\id_rsa",
        "localCopy"             : "COPY",
        "binariesDir"           : "C:\\Program Files\\Microsoft HPC Pack 2008 R2\\Bin",
        "useSharedDir"          : true,
        "workingDir"            : "c:\\Scratch",
        "sharedDir"             : "HEADNODE\\\\Scratch"
};

var winhpcjs = require("./winhpcjs.js")
```
**Generate a submission script with the parameters in jobArgs and save it inside localJobDir**
```
winhpcjs.winscript_js(jobArgs, localJobDir, callback(err,data))
```
**Submit a job with the following submissionScript and send the jobFiles along**
```
winhpcjs.winsub_js(win_config, [submissionScript, jobFiles, ..], callback(err,data))
```
**Gather server information**
```
winhpcjs.winmgr_js(win_config, callback);
```
**Gather node info**
```
winhpcjs.winnodes_js(win_config, nodeName, callback(err,data));
```
**Gather job list**
```
winhpcjs.winjobs_js(win_config, callback(err,data));
```
**Gather job information**
```
winhpcjs.winjobs_js(win_config, jobId, callback(err,data));
```
**List files in working directory**
```
winhpcjs.windir_js(win_config, jobId, callback(err,data));
```
**Download files from a working directory to the localJobDir**
```
winhpcjs.winretrieve_js(win_config, jobId, [jobFiles,..] , localJobDir, callback(err,data))
```
**Cancel a job**
```
winhpcjs.windel_js(win_config, jobId, callback(err,data))
```

### Output exemples

>winnodes_js:
```
[ { 'Node Name': 'HEADNODE',
    State: 'Online',
    Max: '2',
    Run: '0',
    IdleResourceCount: '2',
    Availability: 'AlwaysOn' },
  { 'Node Name': 'NODE01',
    State: 'Online',
    Max: '2',
    Run: '0',
    IdleResourceCount: '2',
    Availability: 'AlwaysOn' } ]
```

>winjobs_js:
```
[ { Id: 1,
    Owner: 'HPCLOCAL\\Administrator',
    Name: 'Test',
    State: 'Finished',
    Priority: 'Normal' },
    ...
  { Id: 54,
    Owner: 'HPCLOCAL\\Administrator',
    Name: 'Test',
    State: 'Finished',
    Priority: 'Normal' } ]
```