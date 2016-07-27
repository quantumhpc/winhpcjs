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
var line_separator = "\r\n";

// General command dictionnary keeping track of implemented features
var cmdDict = {
    "job"      :   ["job", "view", "/detailed:true"],
    "jobs"     :   ["job", "list", "/all", "/format:list"],
    "node"     :   ["node"],
    "nodes"    :   ["node", "list", "/format:list"],
    "submit"   :   ["job", "submit"],
    "delete"   :   ["job", "cancel"],
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

// Treat Windows HPC parameter list containing ':'
function jsonifyParam(output){
    //Separate each line
    output = output.split(line_separator);
    // Look for properties
    var results={};
    for (var i = 0; i < output.length; i++) {
        if (output[i].indexOf(':')!== -1){
            // Split key and value to 0 and 1
            var data = output[i].split(':');
            results[data[0].trim()] = data[1].trim();
        }
    }
    return results;
}

function createUID()
{
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
        return v.toString(16);
    });
}

function createJobWorkDir(win_config, callback){
    // Get configuration working directory and Generate a UID for the working dir
    var jobWorkingDir = path.join(win_config.working_dir,createUID());
    
    //Create workdir with 700 permissions
    var process = spawnProcess([win_shell, '/c', 'IF NOT EXIST ' + jobWorkingDir + ' ' + win_shell + ' /c mkdir ' +jobWorkingDir] ,"shell", null, win_config);
    
    // Transmit the error if any
    if (process.stderr){
        return callback(new Error(process.stderr));
    }
    //TODO:handles error
    return callback(null, jobWorkingDir);
}



// Interface for Win HPC NODE
/** winnodes_js(
    config          :   array of configuration parameters
    controlCmd      :   online/offline
    nodeName        :   node to put on/off line or view info
    callback)
    
    Methods:
    Node list       :   winnodes_js(config, callback)
    Node info       :   winnodes_js(config, nodeName, callback)
    Node control    :   winnodes_js(config, controlCmd, nodeName, callback)
    
**/
function winnodes_js(win_config, controlCmd, nodeName, callback){
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
            if(detailedInfo){
                // Parse info on a node
                return callback(null, jsonifyParam(output.stdout));
            }else{
                var nodes = [];
                // Separate each node
                output = output.stdout.split(line_separator + line_separator);
                //Loop on each node
                for (var j = 0; j < output.length; j++) {
                    if (output[j].length>1){
                        nodes.push(jsonifyParam(output[j]));
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

// Interface for Win HPC JOBS
/** winjobs_js(
    config          :   array of configuration parameters
    jobName         :   job specific info
    callback)
    
    Methods:
    Job list        :   winjobs_js(config, callback)
    Job info       :    winjobs_js(config, jobName, callback)
    
**/
function winjobs_js(win_config, jobId, callback){
    // JobId is optionnal so we test on the number of args
    var args = [];
    // Boolean to indicate if we want the job list
    var jobList = true;
    
    for (var i = 0; i < arguments.length; i++) {
        args.push(arguments[i]);
    }

    // first argument is the config file
    win_config = args.shift();

    // last argument is the callback function
    callback = args.pop();
    
    var remote_cmd;
    
    // Info on a specific job
    if (args.length == 1){
        jobId = args.pop();
        remote_cmd = cmdBuilder(win_config.binaries_dir, cmdDict.job);
        remote_cmd.push(jobId);
        jobList = false;
    }else{
        remote_cmd = cmdBuilder(win_config.binaries_dir, cmdDict.jobs);
    }
    var output = spawnProcess(remote_cmd,"shell",null,win_config);
    
    // Transmit the error if any
    if (output.stderr){
        return callback(new Error(output.stderr));
    }
    
    // Job info or list
    if (jobList){
        // output = output.stdout.split(new RegExp(line_separator + '{2,}','g'));
        output = output.stdout.split(line_separator + line_separator);
        // Parse jobs
        var jobs = [];
        // Last element is Job numbers
        for (var j = 0; j < output.length-1; j++) {
            jobs.push(jsonifyParam(output[j]));
        }
        return callback(null, jobs);
    }else{
        // Return detailed info on a job
        return callback(null,jsonifyParam(output.stdout));
    }
}


function wincancel_js(win_config,jobId,callback){
    
    return callback(null, {"message" : 'Job ' + jobId + ' successfully deleted'});
}

// Generate the script to run the job and write it to the specified path
// Workdir has to be specified, WinHPC does not allow jobfile and workdir
// Job Arguments taken in input : TO COMPLETE
// Return the full path of the SCRIPT
/* jobArgs = {
    jobName         :   String      //  'Name="My Task"'
    ressources      :   String      //  'UnitType="Core" MinCores="1" MaxCores="1"'
    walltime        :   String      //  'RuntimeSeconds="10860"'
    queue           :   String      //  'NodeGroups="AzureNodes,ComputeNode"'
    workdir         :   String      //  'WorkDirectory="workDirPath"'
    stdout          :   String      //  'StdOutFilePath="outFile"'
    stderr          :   String      //  'StdErrFilePath="errFile"'
    exclusive       :   Boolean     //  'IsExclusive="false"'
    mail            :   String      //  'EmailAddress="test@Test.com"'
    mailBegins      :   Boolean     //  'NotifyOnStart="true"'
    mailTerminates  :   Boolean     //  'NotifyOnCompletion="true"'
    commands        :   Array       //  'main commands to run'
    },
    localPath   :   'path/to/save/script'
    callback    :   callback(err,scriptFullPath)
}*/
/* Not implemented:
RunUntilCanceled="false"
JobType="Batch"
JobTemplate="Default"
*/
function winscript_js(jobArgs, localPath, callback){
    var toWrite = '<?xml version="1.0" encoding="utf-8"?>';
    toWrite += line_separator + '<Job';
    
    var jobName = jobArgs.jobName;
    
    // The name has to be bash compatible: TODO expand to throw other erros
    if (jobName.search(/[^a-zA-Z0-9]/g) !== -1){
        return callback(new Error('Name cannot contain special characters'));
    }

    // Generate the script path
    var scriptFullPath = path.join(localPath,jobName + '.xml');
    
    // Job Name
    toWrite += ' Name="' + jobName + '"';
    
    // Ressources
    toWrite += ' UnitType="Core" MinCores="' + jobArgs.ressources + '" MaxCores="' + jobArgs.ressources + '"';
    
    // Walltime: optional
    if (jobArgs.walltime !== undefined && jobArgs.walltime !== ''){
        toWrite += ' RuntimeSeconds="' + jobArgs.walltime + '"';
    }
    
    // Node groups optional
    if (jobArgs.queue !== undefined && jobArgs.queue !== ''){
        toWrite += ' NodeGroups="' + jobArgs.queue + '"';
    }
    
    // Job exclusive
    if (jobArgs.exclusive){
        toWrite += ' IsExclusive="false"';
    }
    
    // Send mail
    if (jobArgs.mail){
    toWrite += ' EmailAddress="' + jobArgs.mail + '"';
    
        if(jobArgs.mailBegins){     
          toWrite += ' NotifyOnStart="true"';
        }
        if(jobArgs.mailTerminates){     
          toWrite += ' NotifyOnCompletion="true"';
        }
    }
    
    // Tasks
    toWrite += '>' + line_separator + '<Tasks>';
    
    // Loop on tasks
    //TODO: allow multiple tasks
        toWrite += line_separator + '<Task';
        // Ressources
        toWrite += ' UnitType="Core" MinCores="' + jobArgs.ressources + '" MaxCores="' + jobArgs.ressources + '"';
        toWrite += ' Name="' + jobName + '"';
        // Workdir
        toWrite += ' WorkDirectory="' + jobArgs.workdir + '"';
        //Stdout and err
        toWrite += ' StdOutFilePath="' + jobArgs.stdout + '" StdErrFilePath="' + jobArgs.stderr + '"';
        //Command
        toWrite += ' CommandLine="' + jobArgs.commands + '"';
        //End
        toWrite += ' />';
    
    // End tasks
    toWrite += line_separator + '</Tasks>' + line_separator + '</Job>';
    
    // Write to script
    fs.writeFileSync(scriptFullPath,toWrite);
    
    return callback(null, {
        "message"   :   'Script for job ' + jobName + ' successfully created',
        "path"      :   scriptFullPath
        });
}

// Interface for job submit
// Submit a script by its absolute path
// winsub_js(
/*    
        win_config      :   config,
        jobArgs         :   array of required files to send to the server with the script in 0,
        jobWorkingDir   :   working directory,
        callack(message, jobId, jobWorkingDir)
}
*/
function winsub_js(win_config, jobArgs, jobWorkingDir, callback){
    var remote_cmd = cmdBuilder(win_config.binaries_dir, cmdDict.submit);
    
    if(jobArgs.length < 1) {
        return callback(new Error('Please submit the script to run'));  
    }
    
    // Send files by the copy command defined
    for (var i = 0; i < jobArgs.length; i++){
        var copyCmd = spawnProcess([jobArgs[i],jobWorkingDir],"copy","send",win_config);
        if (copyCmd.stderr){
            return callback(new Error(copyCmd.stderr));
        }
    }
    // Add script: first element of qsubArgs
    var scriptName = path.basename(jobArgs[0]);
    remote_cmd.push("/jobfile:" + path.join(jobWorkingDir,scriptName));
    
    // Submit
    var output = spawnProcess(remote_cmd,"shell",null,win_config);
    // Transmit the error if any
    if (output.stderr){
        return callback(new Error(output.stderr));
    }
    // Catch job Id
    var jobId = output.stdout.match(/.+?\:\s*([0-9]+)/)[1];
    
    return callback(null, { 
            "message"   : 'Job ' + jobId + ' submitted',
            "jobId"     : jobId,
            "path"      : jobWorkingDir
        });
}

function winqueues_js(win_config, queueName, callback){
    
    return callback(null, queues);
    
}

// Display server info
function mgr_js(win_config, mgrCmd, callback){
    
    
    return callback(null, mgrInfo);
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
    winnodes_js           : winnodes_js,
    winjobs_js            : winjobs_js,
    winscript_js          : winscript_js,
    winsub_js             : winsub_js,
    createJobWorkDir      : createJobWorkDir
};