var cproc = require('child_process');
var spawn = cproc.spawnSync;
var path = require("path");
var ipc = require('node-ipc');

// Specific UserID socket
if(process.argv[2]){
    // First try argument
    ipc.config.id = process.argv[2].trim();
}else{
    // Then environment
    ipc.config.id = process.env.agentId.trim();
}

if(ipc.config.id === undefined){
    console.log("Unable to find a valid agentId");
    process.exit(1);
}
// Default config
ipc.config.retry    = 1500;
ipc.config.silent   = false;
ipc.config.sync     = true;

ipc.serve(function(){
        
        // Ping-pong test
        ipc.server.on('ping',function(data,socket){
            ipc.server.emit(socket,'pong',
                {
                    id          : ipc.config.id,
                    username    : process.env.USERNAME,
                    domain      : process.env.USERDOMAIN
                }
            );
        });
        // Submit a job
        ipc.server.on('action',function(data,socket){
            var args = ["submit"];
            // Insert jobfile
            args.push("/jobfile:" + data.jobfile);
            
            // Windows HPC job binary
            var winJob = path.join(data.win_config.binariesDir, "job");
            // Submit
            var result = spawn(winJob, args, 
                {
                    shell       :   false, 
                    encoding    :   'utf8',
                    timeout     :   5000
                });
            ipc.server.emit(socket,'answer',result);
        });
    }
);

ipc.server.start();