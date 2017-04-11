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
var dirRegEx = /^\s*Directory of (.+)/;
var winAgent = require("./winAgent");

// General command dictionnary keeping track of implemented features
var cmdDict = {
    "setcreds" :   ["hpccred ", "setcreds"],
    "delcreds" :   ["hpccred ", "delcreds"],
    "job"      :   ["job", "view", "/detailed:true"],
    "jobs"     :   ["job", "list", "/all", "/format:list"],
    "task"      :  ["task", "view", "/detailed:true"],
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
function spawnProcess(spawnCmd, spawnType, spawnDirection, win_config, opts){
    var spawnExec;
    var spawnOpts = opts || {};
    spawnOpts.encoding = 'utf8';
	// Timeout command if the credentials are not set
    spawnOpts.timeout = 10000;
    switch (spawnType){
        case "shell":
            case "local":
                spawnExec = spawnCmd.shift();
            break;
        //Copy the files according to the spawnCmd array : 0 is the file, 1 is the destination dir
        case "copy":
            case "local":
                spawnExec = win_config.localCopy;
                spawnOpts.shell = true;
            break;
    }
    var spawnReturn = spawn(spawnExec, spawnCmd, spawnOpts);
    
    // Restart on first connect
    if(spawnReturn.stderr && spawnReturn.stderr.indexOf("Warning: Permanently added") > -1){
        return spawn(spawnExec, spawnCmd, spawnOpts);
    }else{
        return spawnReturn;
    }
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

            var label = data[0].trim();
            var value = data[1].trim();
            // Convert JobId to number for better sorting
            if(label === "Id"){
                value = Number(value);
            }
            results[label] = value;
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


// Windows does not support UID/GID, so we insert /user: on each command
function insertUsername(win_config){
    return " /user:" + win_config.domain + "\\" + win_config.username;
}

// Return the Working Directory
function getJobWorkDir(win_config, jobId, callback){
    
    // Retrive Path
    winjobs_js(win_config, jobId, function(err,data){
        if(err){
            return callback(err);
        }
        var jobWorkingDir;
        try{
            jobWorkingDir = path.resolve(data.WorkDirectory);
        }catch(e){
            return callback(new Error("Working directory not found"));
        }
        
        return callback(null, jobWorkingDir);
    });
}

// Create a unique working directory in the global working directory from the config
function createJobWorkDir(win_config, callback){
    
    // Get configuration working directory and Generate a UID for the working dir
    var workUID = createUID();
    
    // Get configuration working directory and Generate a UID for the working dir
    var jobWorkingDir = path.join(win_config.workingDir,workUID);
    
    //Create workdir with 700 permissions
    var process = spawnProcess([win_shell, '/c', 'IF NOT EXIST ' + jobWorkingDir + ' ' + win_shell + ' /c mkdir ' +jobWorkingDir] ,"shell", null, win_config);
    
    // Transmit the error if any
    if (process.stderr){
        return callback(new Error(process.stderr));
    }
    
    //TODO:handles error
    return callback(null, jobWorkingDir);
}

// Set credentials with plain-text password on command line
function winCreds(win_config, password, callback){
    
    var remote_cmd = cmdBuilder(win_config.binariesDir, cmdDict.setcreds);
    // User
    remote_cmd += insertUsername(win_config);
    
    // Password
    remote_cmd += " /password:" + password;
    
    var output = spawnProcess(remote_cmd,"shell",null,win_config);
    // Transmit the error if any
    if (output.stderr){
        return callback(new Error(output.stderr.split(line_separator)[0]));
    }

    return callback(null, true);
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
                remote_cmd = cmdBuilder(win_config.binariesDir, cmdDict.node);
                remote_cmd = remote_cmd.concat(nodeControlCmd[controlCmd]);
                remote_cmd.push(nodeName);
                parseOutput = false;
                break;
            case 1:
                // Node specific info
                nodeName = args.pop();
                remote_cmd = cmdBuilder(win_config.binariesDir, cmdDict.node);
                remote_cmd = remote_cmd.concat(nodeControlCmd.view);
                remote_cmd.push(nodeName);
                detailedInfo = true;
                break;
            default:
                // Default
                remote_cmd = cmdBuilder(win_config.binariesDir, cmdDict.nodes);
        }
        
        var output = spawnProcess(remote_cmd,"shell",null,win_config);
        
        // Transmit the error if any
        if (output.stderr){
            return callback(new Error(output.stderr.split(line_separator)[0]));
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
    //TODO: implement 'job view' on all jobs
    if (args.length == 1 && jobId !== 'all'){
        jobId = args.pop();
        remote_cmd = cmdBuilder(win_config.binariesDir, cmdDict.job);
        remote_cmd.push(jobId);
        jobList = false;
    }else{
        remote_cmd = cmdBuilder(win_config.binariesDir, cmdDict.jobs);
    }
    var output = spawnProcess(remote_cmd,"shell",null,win_config);
    
    // Transmit the error if any
    if (output.stderr){
        return callback(new Error(output.stderr.split(line_separator)[0]));
    }
    // Job info or list
    if (jobList){
        output = output.stdout.split(line_separator + line_separator);
        // Parse jobs
        var jobs = [];
        // Last element is Job numbers
        for (var j = 0; j < output.length-1; j++) {
            jobs.push(jsonifyParam(output[j]));
        }
        return callback(null, jobs);
    }else{
        // Assuming a mono-task job, get further info with task view
        remote_cmd = cmdBuilder(win_config.binariesDir, cmdDict.task);
        remote_cmd.push(jobId + ".1");
        var output2 = spawnProcess(remote_cmd,"shell",null,win_config);
        // Transmit the error if any
        if (output2.stderr){
            return callback(new Error(output2.stderr.split(line_separator)[0]));
        }
        // Return detailed info on a job
        return callback(null,jsonifyParam(output.stdout + output2.stdout));
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
    resources       :   String      //  'UnitType="Core" MinCores="1" MaxCores="1"'
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
    env             :   Object       //  key/value pairs of environment variables
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
    var toWrite = '<?xml version="1.0" encoding="utf-8"?>' + line_separator;
    toWrite += '<Job';
    
    var jobName = jobArgs.jobName;
    
    // The name has to be bash compatible: TODO expand to throw other erros
    if (jobName.search(/[^a-zA-Z0-9]/g) !== -1){
        return callback(new Error('Name cannot contain special characters'));
    }

    // Generate the script path
    var scriptFullPath = path.join(localPath,jobName + '.xml');
    
    // Job Name
    toWrite += ' Name="' + jobName + '"';
    
    // Resources
    jobArgs.resources = parseResources(jobArgs.resources);
    toWrite += jobArgs.resources;
    
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
    
    // Close job
    toWrite += '>' + line_separator;
    
    // EnvironmentVariables
    if(jobArgs.env){
        toWrite += '<EnvironmentVariables>' + line_separator;
        
        for(var _env in jobArgs.env){
            toWrite += '<Variable>' + line_separator;
            toWrite += '<Name>' + _env + '</Name>' + line_separator;
            toWrite += '<Value>' + jobArgs.env[_env] + '</Value>' + line_separator;
            toWrite += '</Variable>' + line_separator;
        }
        
        // Close
        toWrite += '</EnvironmentVariables>' + line_separator;
    }
    
    // Tasks
    toWrite += '<Tasks>' + line_separator;
    
    // Loop on tasks
    //TODO: allow multiple tasks
        toWrite += '<Task';
        // Resources
        toWrite += jobArgs.resources;
        toWrite += ' Name="' + jobName + '"';
        // Workdir
        toWrite += ' WorkDirectory="' + jobArgs.workdir + '"';
        //Stdout and err
        toWrite += ' StdOutFilePath="' + jobArgs.stdout + '" StdErrFilePath="' + jobArgs.stderr + '"';
        //Command
        toWrite += ' CommandLine="' + jobArgs.commands + '"';
        //End
        toWrite += ' />' + line_separator;
    
    // End tasks
    toWrite += '</Tasks>' + line_separator + '</Job>';
    
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
    
    // Use Node-IPC to submit the job as the username
    if(win_config.useAgent){
        winAgent.ping(win_config, function(err, pong){
            if (err){
                return callback(err);
            }
            // Check ownership
            if(pong.username === win_config.username && pong.domain === win_config.domain){
                winAgent.submit(win_config, path.join(jobWorkingDir, scriptName), function(err, output){
                    if (err){
                        return callback(err);
                    }else{
                        return submitCallback(output, jobWorkingDir, callback);
                    }
                });
            }else{
                return callback(new Error("Wrong username"));
            }
        });
    }else{
        //Without agent, submit the job as the user running the process (Administrator)
        var remote_cmd = cmdBuilder(win_config.binariesDir, cmdDict.submit);
        remote_cmd.push("/jobfile:" + scriptName);
    
        // Submit
        return submitCallback(spawnProcess(remote_cmd,"shell",null,win_config, { cwd : jobWorkingDir}), jobWorkingDir, callback);
    }
}

function submitCallback(output, jobWorkingDir, callback){
    // Transmit the error if any
    if (output.stderr){
        return callback(new Error(output.stderr.split(line_separator)[0]));
    }
    // WinHPC requires password to be cached
    if(output.stdout.indexOf('Remember this password') > -1){
        return callback(new Error("Password has not been saved, use hpccred to cache your password"));
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
    // JobId is optionnal so we test on the number of args
    var args = [];
    for (var i = 0; i < arguments.length; i++) {
        args.push(arguments[i]);
    }
    
    // first argument is the config file
    win_config = args.shift();

    // last argument is the callback function
    callback = args.pop();
    
    var remote_cmd;
    var queues = [];
    
    // Return manual configuration until better wrapper implemented
    for(var queue in win_config.nodeGroups){
        queues.push({ name: win_config.nodeGroups[queue],
            maxJobs: '0',
            queued: '0',
            running: '0'
        });
    }
    return callback(null, queues);
    
}

// Interface for Job delete
// Delete the specified job Id and return the message and the status code
function windel_js(win_config,jobId,callback){
    // JobId is optionnal so we test on the number of args
    var args = [];
    for (var i = 0; i < arguments.length; i++) {
        args.push(arguments[i]);
    }

    // first argument is the config file
    win_config = args.shift();

    // last argument is the callback function
    callback = args.pop();
    
    var remote_cmd = cmdBuilder(win_config.binariesDir, cmdDict.delete);
    
    if (args.length !== 1){
        // Return an error
        return callback(new Error('Please specify the jobId'));
    }else{
        jobId = args.pop();
        remote_cmd.push(jobId);
    }
    
    var output = spawnProcess(remote_cmd,"shell",null,win_config);
    
    // Transmit the error if any
    if (output.stderr){
        return callback(new Error(output.stderr.split(line_separator)[0]));
    }
    // Job deleted returns
    return callback(null, {"message" : 'Job ' + jobId + ' successfully deleted'});
}

// Display server info
function mgr_js(win_config, mgrCmd, callback){
    
    
    return callback(null, mgrInfo);
}

function windir_js(win_config, jobId, callback){
    // Check if the user is the owner of the job
    getJobWorkDir(win_config, jobId, function(err, jobWorkingDir){
        if(err){
            return callback(err);
        }
        // TOOD: put in config file
        var remote_cmd = ["dir", "/s", jobWorkingDir];
        var output = spawnProcess(remote_cmd,"shell",null,win_config,{shell : true});
        
        // Transmit the error if any
        if (output.stderr){
            return callback(new Error(output.stderr.split(line_separator)[0]));
        }
        output.stdout = output.stdout.split(line_separator + line_separator);
        
        
        var fileList        = [];
        fileList.files      = [];
        fileList.folders    = [];
        
        //Loop on folders, first line is header, last line is summary
        for(var folder=1;folder<output.stdout.length-1;folder+=2){
            // Directory
            var folderPath = output.stdout[folder].match(dirRegEx)[1];
            fileList.folders.push(folderPath);
            
            // Loop on files
            var files = output.stdout[folder+1].split(line_separator);
            for(var _f=0;_f<files.length-1;_f++){
                var fileInfo = files[_f].trim().split(/\s/g);
                // Save only files
                if(fileInfo.indexOf('<DIR>') === -1){
                    fileList.files.push(path.resolve(folderPath,fileInfo.pop()));
                }
            }
        }
        
        return callback(null, fileList);
    });
}

function winretrieve_js(win_config, jobId, fileList, localDir, callback){
    
    return callback(null,{
            "message"   : 'Files for the job ' + jobId + ' have all been retrieved in ' + localDir
        });

}
// Parse resources and return the UnitType="Core||Socket||Nodes"  statement
//TODO: check against resources_available
/**
 * {
     cores          :   [Int],
     nodes          :   [Int],
     sockets        :   [Int]
   }
**/
function parseResources(resources){
    
    // Inject UnitType Core||Node||Socket
    var unitType;
    var unitValue;
    if(resources.cores){
        unitType = "Core";
        unitValue = resources.cores;
    }else if(resources.nodes){
        unitType = "Node";
        unitValue = resources.nodes;
    }else if(resources.sockets){
        unitType = "Socket";
        unitValue = resources.sockets;
    }
    return ' UnitType="' + unitType + '" Min' + unitType + 's="' + unitValue + '" Max' + unitType + 's="' + unitValue + '"';
}


module.exports = {
    winCreds              : winCreds,
    winnodes_js           : winnodes_js,
    winjobs_js            : winjobs_js,
    winscript_js          : winscript_js,
    windel_js             : windel_js,
    winqueues_js          : winqueues_js,
    winsub_js             : winsub_js,
    windir_js             : windir_js,
    winretrieve_js        : winretrieve_js,
    getJobWorkDir         : getJobWorkDir,
    createJobWorkDir      : createJobWorkDir
};