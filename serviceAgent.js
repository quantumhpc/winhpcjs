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
    try{
        ipc.config.id = process.env.agentId.trim();
    }catch(e){
        console.log("Unable to find a valid agentId");
        process.exit(1);
    }
}
console.log("Agent for " + ipc.config.id + " started");
// Default config
ipc.config.retry    = 1500;
ipc.config.silent   = true;
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
        ipc.server.on('action', 
        //** INSERT HERE SCHEDULER SPECIFIC COMMAND **//
        function(data,socket){
            var args = ["submit"];
            // Insert jobfile
            args.push("/jobfile:" + path.join(data.jobWorkingDir,data.jobfile));
            
            // Windows HPC job binary
            var winJob = path.join(data.win_config.binariesDir, "job");
            // Submit
            var result = spawn(winJob, args, 
                {
                    shell       :   false, 
                    encoding    :   'utf8',
                    timeout     :   5000
                });
        // END HERE 
            ipc.server.emit(socket,'answer',result);
        });
    }
);

ipc.server.on('error',function(err){
    console.log(err);
});

ipc.server.start();