var fs = require("fs");
var path = require("path");
var ipc = require('node-ipc');
var Service = require('node-windows').Service;
var agentFolder = path.join(process.cwd(), 'agents');
try{
    fs.mkdirSync(agentFolder);
}catch(e){}
    
ipc.config.id = 'server';
ipc.config.retry = 2000;
ipc.config.silent = true;
ipc.config.maxRetries = 2;

/**********************************************************************
 * Windows Agents
 **********************************************************************/
function configureAgent(win_config, next){
    var agentName = "QHPC_" + win_config.username + "_Agent";
    var daemonDir =  path.join(agentFolder, win_config.agentId);
    try{
        fs.mkdirSync(daemonDir);
    }catch(e){}
    
    // Create a new service object
    var svc = new Service({
      name: agentName,
      description: 'Quantum HPC Platform Agent for ' + win_config.username,
      script: path.join(__dirname, 'serviceAgent.js'),
      env: [{
        name: "agentId",
        value: win_config.agentId
      }]
    });
    
    // Set a directory per agent
    svc._directory = daemonDir;
    
    svc.on('error',function(err){
        console.log("error inside agent")
        console.log(err)
        return next(err);
    });
    return next(null, svc);
}

// Test if an agent is online,
// Return (err, agentId)
function install(win_config, password, next){
    configureAgent(win_config, function(err, service){
        if(err){
            return next(err);
        }
        var once = true;
        
        var daemonXmlFile = path.join(service._directory, "daemon", service.name + '.xml');
        
        service.logOnAs.domain = win_config.domain;
        service.logOnAs.account = win_config.username;
        service.logOnAs.password = password;
        
        // Listen for the "install" event, which indicates the
        // process is available as a service.
        service.on('install',function(){
            //Start the service
        console.log('installed')
            service.start();
        });
    
        service.on('start',function(){
            if(once){
                once = false;
                // Delete password from file
                fs.readFile(daemonXmlFile, 'utf8', function(err, xmlContent){
                    if(err){
                        console.log(err);
                    }else{
                        // Supress password
                        xmlContent = xmlContent.replace(
                            /<password>.+?<\/password>/g,
                            "<password>XXXXXX</password>");
                        // Rewrite
                        fs.writeFile(daemonXmlFile, xmlContent, 'utf8', function(err){
                            if(err){
                                return next(err);
                            }else{
        console.log('success')
        console.log(service.exists)
                                // Success
                                return next(null);
                            }
                        });
                    }
                });
            }
        });
        
    
        //Install and start
        console.log('installing')
        service.install();
    });
}

function exists(win_config, next){
    configureAgent(win_config, function(err, service){
        if(err){
            return next(err);
        }
        // Verify existence
        if(service.exists){
            return next(null);
        }else{
            return next(new Error('Agent is not installed.'));
        }
    });
}

function start(win_config, next){
    configureAgent(win_config, function(err, service){
        if(err){
            return next(err);
        }
        var once = true;
        
        // Listen for the "uninstall" event so we know when it's done.
        service.on('start',function(){
            // Uninstall the service.
            if(once){
                once = false;
                next();
            }
        });
        // Start service
        service.start();
    });
}

function stop(win_config, next){
    configureAgent(win_config, function(err, service){
        if(err){
            return next(err);
        }
        var once = true;
        
        // Listen for the "stop" event
        service.on('stop',function(){
            // Uninstall the service.
            if(once){
                once = false;
                return next();
            }
        });
        // Stop service
        service.stop();
    });
}

function restart(win_config, next){
    configureAgent(win_config, function(err, service){
        if(err){
            return next(err);
        }
        var onceStop = true;
        var onceStart = true;
        
        // Listen for the "stop" event
        service.on('stop',function(){
            // Uninstall the service.
            if(onceStop){
                onceStop = false;
                setTimeout(function(){
                    // Start service
                    service.start();
                },2000);
            }
        });
        
        // Listen for the "uninstall" event so we know when it's done.
        service.on('start',function(){
            // Uninstall the service.
            if(onceStart){
                onceStart = false;
                next();
            }
        });
        
        // Stop service
        service.stop();
    });
}


function uninstall(win_config, next){
    configureAgent(win_config, function(err, service){
        if(err){
            return next(err);
        }
        var once = true;
    
        // Listen for the "stop" event
        service.on('stop',function(){
            // Uninstall the service.
            if(once){
                once = false;
                service.uninstall();
            }
        });
        
        // Listen for the "uninstall" event
        service.on('uninstall',function(){
            // Success
            return next(null);
        });
        
        // Stop and uninstall
        service.stop();
    });
}

/**********************************************************************
 * IPC Messages
 **********************************************************************/
// Submit job to an agent by jobfile
function submit(win_config, jobFile, next){
    
    // Connect to AgentId        
    ipc.connectTo(win_config.agentId,function(){
        //On Connect, send action
        ipc.of[win_config.agentId].on('connect',function(){
            ipc.of[win_config.agentId].emit('action',
                {
                    win_config      :   win_config,
                    jobfile         :   jobFile
                }
            );
        });
        ipc.of[win_config.agentId].on('answer',function(data){
            ipc.disconnect(win_config.agentId);
            return next(null, data);
        });
        ipc.of[win_config.agentId].on('error', function(err){
            if(err.code === 'ENOENT'){
                return next(new Error('Agent is unreachable.'));
            }else{
                return next(err);
            }
        });
    });
}


// Test if an agent is online,
// Return (err, {agentId, username})
function ping(win_config, next){
    // Count ping-ping, destroy event is emitted even if it works
    var pingPongTest = 0;
    // Connect to AgentId        
    ipc.connectTo(win_config.agentId,function(){
        //Send ping, listen for pong
        ipc.of[win_config.agentId].on('connect',function(){
            ipc.of[win_config.agentId].emit('ping');
        });
        ipc.of[win_config.agentId].on('pong',function(data){
            ipc.disconnect(win_config.agentId);
            return next(null, data);
        });
        ipc.of[win_config.agentId].on('error', function(err){
            if(err.code === 'ENOENT'){
                pingPongTest++;
                if(pingPongTest === ipc.config.maxRetries){
                    return next(new Error('Agent is unreachable.'));
                }
            }else{
                return next(err);
            }
        });
    });
}


module.exports = {
    install         :   install,
    uninstall       :   uninstall,
    exists          :   exists,
    start           :   start,
    stop            :   stop,
    restart         :   restart,
    ping            :   ping,
    submit          :   submit
};