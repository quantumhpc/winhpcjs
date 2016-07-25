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


function spawnProcess(spawnCmd, spawnType, spawnDirection, win_config){
    var spawnExec;
    // UID and GID throw a core dump if not correct numbers
    if ( Number.isNaN(win_config.uid) || Number.isNaN(win_config.gid) ) {
        return {stderr : "Please specify valid uid/gid"};
    }  
    var spawnOpts = { encoding : 'utf8', uid : win_config.uid , gid : win_config.gid};
    switch (spawnType){
        case "shell":
            switch (win_config.method){
                case "ssh":
                    spawnExec = win_config.ssh_exec;
                    spawnCmd = [win_config.username + "@" + win_config.serverName,"-o","StrictHostKeyChecking=no","-i",win_config.secretAccessKey].concat(spawnCmd);
                    break;
                case "local":
                    spawnExec = spawnCmd.shift();
                    spawnOpts.shell = win_config.local_shell;
                    break; 
            }
            break;
        //Copy the files according to the spawnCmd array : 0 is the file, 1 is the destination dir
        case "copy":
            // Special case if we can use a shared file system
            if (win_config.useSharedDir){
                spawnExec = win_config.local_copy;
                spawnOpts.shell = win_config.local_shell;
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
                        spawnOpts.shell = win_config.local_shell;
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
    spawnProcess(["[ -d "+jobWorkingDir+" ] || mkdir -m 700 "+jobWorkingDir],"shell", null, win_config);
    
    //TODO:handles error
    return jobWorkingDir;
}


function script_js(jobArgs, localPath, callback){
   
    return callback(null, {
        "message"   :   'Script for job ' + jobName + ' successfully created',
        "path"      :   scriptFullPath
        });
}

// Return the list of nodes
function nodes_js(win_config, controlCmd, nodeName, callback){
    
        return callback(null, { 
            "message"   : 'Node ' + nodeName + ' put in ' + controlCmd + ' state.',
        });
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
