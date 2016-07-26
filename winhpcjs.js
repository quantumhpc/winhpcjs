/* 
* Copyright (C) 2015-2016 Quantum HPC Inc.
*
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU Affero General Public License as
* published by the Free Software Foundation, either version 3 of the
* License, or (at your option) any later version.
*
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU Affero General Public License for more details.
*
* You should have received a copy of the GNU Affero General Public License
* along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
var cproc = require('child_process');
var spawn = cproc.spawnSync;
var fs = require("fs");
var path = require("path");
var win_shell = process.env.comspec;

// General command dictionnary keeping track of implemented features
var cmdDict = {
    "queue"    :   ["qstat", "-Q"],
    "queues"   :   ["qstat", "-Q"],
    "job"      :   ["qstat", "-f"],
    "jobs"     :   ["job", "list", "/all"],
    "node"     :   ["node", "view"],
    "nodes"    :   ["node", "list"],
    "submit"   :   ["job", "submit"],
    "delete"   :   ["job", "cancel"],
    "setting"  :   ["qmgr", "-c"],
    "settings" :   ["qmgr", "-c","'p s'"]
    };
    
var nodeControlCmd = {
    'online'    :  ["online"],
    'offline'   :  ["offline"],
    'view'      :  ["view","/detailed:true"]
};

// Helper function to return an array with [full path of exec, arguments] from a command of the cmdDict
function cmdBuilder(binPath, cmdDictElement){
    return [path.join(binPath, cmdDictElement[0])].concat(cmdDictElement.slice(1,cmdDictElement.length));
}

// Parse the command and return stdout of the process depending on the method
/*
    spawnCmd                :   shell command   /   [file, destinationDir], 
    spawnType               :   shell           /   copy, 
    spawnDirection          :   null            /   send || retrieve, 
    pbs_config
*/
// TODO: treat errors
function spawnProcess(spawnCmd, spawnType, spawnDirection, win_config){
    var spawnExec;
    // UID and GID throw a core dump if not correct numbers
    if ( Number.isNaN(win_config.uid) || Number.isNaN(win_config.gid) ) {
        return {stderr : "Please specify valid uid/gid"};
    }  
    var spawnOpts = { encoding : 'utf8'};
    switch (spawnType){
        case "shell":
            switch (win_config.method){
                case "ssh":
                    spawnExec = win_config.ssh_exec;
                    spawnCmd = [win_config.username + "@" + win_config.serverName,"-o","StrictHostKeyChecking=no","-i",win_config.secretAccessKey].concat(spawnCmd);
                    break;
                case "local":
                    spawnExec = spawnCmd.shift();
                    break; 
            }
            break;
        //Copy the files according to the spawnCmd array : 0 is the file, 1 is the destination dir
        case "copy":
            // Special case if we can use a shared file system
            if (win_config.useSharedDir){
                spawnExec = win_config.local_copy;
                spawnOpts.shell = true;
            }else{
                switch (win_config.method){
                    // Build the scp command
                    case "ssh":
                        spawnExec = win_config.scp_exec;
                        var file;
                        var destDir;
                        switch (spawnDirection){
                            case "send":
                                file    = spawnCmd[0];
                                destDir = win_config.username + "@" + win_config.serverName + ":" + spawnCmd[1];
                                break;
                            case "retrieve":
                                file    = win_config.username + "@" + win_config.serverName + ":" + spawnCmd[0];
                                destDir = spawnCmd[1];
                                break;
                        }
                        spawnCmd = ["-o","StrictHostKeyChecking=no","-i",win_config.secretAccessKey,file,destDir];
                        break;
                    case "local":
                        spawnExec = win_config.local_copy;
                        spawnOpts.shell = true;
                        break;
                }
            }
            break;
    }
    return spawn(spawnExec, spawnCmd, spawnOpts);
}

function createUID()
{
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
        return v.toString(16);
    });
}

function createJobWorkDir(win_config){
    // Get configuration working directory and Generate a UID for the working dir
    var jobWorkingDir = path.join(win_config.working_dir,createUID());
    
    //Create workdir with 700 permissions
    spawnProcess([win_shell, '/c', 'IF NOT EXIST ' + jobWorkingDir + ' ' + win_shell + ' /c mkdir ' +jobWorkingDir] ,"shell", null, win_config);
    
    //TODO:handles error
    return jobWorkingDir;
}


function script_js(jobArgs, localPath, callback){
   
    return callback(null, {
        "message"   :   'Script for job ' + jobName + ' successfully created',
        "path"      :   scriptFullPath
        });
}

// Interface for Win HPC NODE
/** nodes_js(
    config          :   array of configuration parameters
    controlCmd      :     online/offline
    nodeName        :       node to put on/off line or view info
    callback)
    
    Methods:
    Node list       :   nodes_js(config, callback)
    Node info       :   nodes_js(config, nodeName, callback)
    Node control    :   nodes_js(config, controlCmd, nodeName, callback)
    
**/
function nodes_js(win_config, controlCmd, nodeName, callback){
    // controlCmd & nodeName are optionnal so we test on the number of args
    var args = [];
    for (var i = 0; i < arguments.length; i++) {
        args.push(arguments[i]);
    }

    // first argument is the config file
    win_config = args.shift();

    // last argument is the callback function
    callback = args.pop();
    
    var remote_cmd;
    var parseOutput = true;
    var detailedInfo = false;
    
    // Command, Nodename or default
    switch (args.length){
        case 2:
            // Node control
            nodeName = args.pop();
            controlCmd = args.pop();
            remote_cmd = cmdBuilder(win_config.binaries_dir, cmdDict.node);
            remote_cmd = remote_cmd.concat(nodeControlCmd[controlCmd]);
            remote_cmd.push(nodeName);
            parseOutput = false;
            break;
        case 1:
            // Node specific info
            nodeName = args.pop();
            remote_cmd = cmdBuilder(win_config.binaries_dir, cmdDict.node);
            remote_cmd = remote_cmd.concat(nodeControlCmd.view);
            remote_cmd.push(nodeName);
            detailedInfo = true;
            break;
        default:
            // Default
            remote_cmd = cmdBuilder(win_config.binaries_dir, cmdDict.nodes);
    }
    
    var output = spawnProcess(remote_cmd,"shell",null,win_config);
    // Transmit the error if any
    if (output.stderr){
        return callback(new Error(output.stderr));
    }
    
    if (parseOutput){
        //Separate each line
        output = output.stdout.split('\r\n');
        if(detailedInfo){
            // Look for properties
            var results={};
            for (var param = 0; param < output.length; param++) {
                if (output[param].indexOf(':')!== -1){
                    // Split key and value to 0 and 1
                    var data = output[param].split(':');
                    results[data[0].trim()] = data[1].trim();
                }
            }
            // Parse info on a node
            return callback(null, results);
        }else{
            var nodes = [];
            var labels = ["Name", "State", "Max", "Run", "Idle", "Availability"];
            //Loop on each node starting line 2
            for (var j = 2; j < output.length; j++) {
                if (output[j].length>1){
                    var node = {};
                    //Split at spaces
                    output[j]  = output[j].trim().split(/\s+/);
                    for (var k = 0; k < labels.length; k++) {
                        node[labels[k]] = output[j][k];
                    }
                    nodes.push(node);
                }
            }
            return callback(null, nodes);
        }
    }else{
        return callback(null, { 
            "message"   : 'Node ' + nodeName + ' put in ' + controlCmd + ' state.',
        });
    }
}

function queues_js(win_config, queueName, callback){
    
    return callback(null, queues);
    
}
    
function stat_js(win_config, jobId, callback){
    
    return callback(null, output);
}

function del_js(win_config,jobId,callback){
    
    return callback(null, {"message" : 'Job ' + jobId + ' successfully deleted'});
}


// Display server info
function mgr_js(win_config, mgrCmd, callback){
    
    
    return callback(null, mgrInfo);
}



function sub_js(win_config, subArgs, callback){
    
    return callback(null, { 
            "message"   : 'Job ' + jobId + ' submitted',
            "jobId"     : jobId,
            "path"      : jobWorkingDir
        });
}


function find_js(win_config, jobId, callback){
    
    return callback(null, fileList);
}

function retrieve_js(win_config, jobId, fileList, localDir, callback){
    
    return callback(null,{
            "message"   : 'Files for the job ' + jobId + ' have all been retrieved in ' + localDir
        });

}

module.exports = {
};
