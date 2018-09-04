var cproc = require('child_process');
var spawn = cproc.spawnSync;
var fs = require("fs");
var os = require("os");
var path = require("path");
var win_shell = process.env.comspec;
var powershell = "C:\\Windows\\system32\\WindowsPowerShell\\v1.0\\powershell.exe";
var HPCsnapIn = "Add-PSSnapIn Microsoft.HPC;";
// Format Powershell output as list
var powershellFormat = " | Format-List -Property *";
var dirRegEx = /^\s*Directory of (.+)/;


// General command dictionnary keeping track of implemented features
var cmdDict = {
    "setcreds"  :   ["hpccred", "setcreds"],
    "delcreds"  :   ["hpccred", "delcreds"],
    "clusrun"   :   ["clusrun"],
    "job"       :   ["job", "view /detailed:true ID"],
    "jobs"      :   ["job", "list /all /format:list"],
    "modify"    :   ["job", "modify ID"],
    "psjob"     :   ["ps", "Get-HpcJob ID"],
    "psjobs"    :   ["ps", "Get-HpcJob -State All"],
    "task"      :   ["task", "view /detailed:true ID"],
    "pstask"    :   ["ps", "Get-HpcTask -JobId ID"],
    "node"      :   ["nodehpc", "view /detailed:true ID"],
    "nodes"     :   ["nodehpc", "list /format:list"],
    "psnode"    :   ["ps", "Get-HpcNode ID"],
    "psnodes"   :   ["ps", "Get-HpcNode"],
    "group"     :   ["ps", "Get-HpcGroup"],
    "groups"    :   ["ps", "Get-HpcGroup"],
    "submit"    :   ["job", "submit /jobfile:ID"],
    "pssubmit"  :   ["ps", "New-HpcJob -JobFile ID | Submit-HpcJob"],
    "cancel"    :   ["job", "cancel ID"],
    "pscancel"  :   ["ps", "Stop-HpcJob ID"],
    "metric"    :   ["ps", "Get-HpcMetricValue -Name"],
    "metrics"   :   ["ps", "Get-HpcMetricValue"]
    };
    
var nodeControlCmd = {
    'online'    :  ["online"],
    'offline'   :  ["offline"]
};

// Functions available in Command Prompt and Powershell
var winFn = {};

// Helper function to return an array with [full path of exec, arguments] from a command of the cmdDict
function cmdBuilder(binPath, cmdDictElement, element){
    var mainCmd = cmdDictElement[0] + '.exe';
    var args = null;
    if(cmdDictElement[1]){
        args = cmdDictElement[1].replace("ID",element);
    }
    if(mainCmd === 'ps'){
        // Powershell cmdlet, Format as list in the end
        return [powershell, "-Command", HPCsnapIn + args + powershellFormat];
    }else{
        // Regular cmd
        if(args){
            args = args.split(/\s/g);
        }else{
            args = [];
        }
        return [path.join(binPath, mainCmd)].concat(args);
    }
}

// Parse the command and return stdout of the process depending on the method
/*
    spawnCmd                :   shell command   /   [file, destinationDir], 
    spawnType               :   shell           /   copy, 
    spawnDirection          :   null            /   send || retrieve, 
    pbs_config
*/
// TODO: treat errors
function spawnProcess(spawnCmd, spawnType, spawnDirection, win_config, opts, callback){
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
    if(spawnReturn.stderr){
        spawnReturn.error = new Error(spawnReturn.stderr.split(os.EOL)[0]);
    }
    return spawnReturn;
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

// Treat Windows HPC parameter list containing ':'
function jsonifyParam(output){
    //Separate each line and do not split continuing line
    output = output.split(/\r\n(?!\s{4,})/g);
    // Look for properties
    var results={};
    for (var i = 0; i < output.length; i++) {
        if (output[i].indexOf(':')!== -1){
            // Split key and value to 0 and 1
            var data = output[i].split(':');
            var label = data.shift().trim();
            // Replace split line by a single space
            var value = data.join(':').trim().replace(/\r\n/g,"").replace(/\s{4,}/g," ");
            // Convert JobId to number for better sorting
            if(label === "Id"){
                value = Number(value);
            }
            results[label] = value;
        }
    }
    return results;
}

function jsonifyMetrics(output){
    //Separate each line and do not split continuing line
    output = output.trim().split(os.EOL + os.EOL);
    // Look for properties
    var results={};
    for (var i = 0; i < output.length; i++) {
        var metricResult = {};
        // Split by property
        output[i] = output[i].split(os.EOL);
        for (var j = 0; j < output[i].length; j++) {
            if (output[i][j].indexOf(':')!== -1){
                // Split key and value to 0 and 1
                var data = output[i][j].split(':');
                var label = data.shift().trim();
                // Replace split line by a single space
                var value = data.join(':').trim();
                metricResult[label] = value;
            }
        }
        // Parse metric results
        if(metricResult.NodeName === ''){
            metricResult.NodeName = 'global';
        }else{
            if(metricResult.Counter){
                metricResult.Metric += "(" + metricResult.Counter + ")";
            }
        }
        // Save
        results[metricResult.NodeName] = results[metricResult.NodeName] || {NodeName : metricResult.NodeName};
        results[metricResult.NodeName][metricResult.Metric] = metricResult.Value;
    }
    var ordered = [];
    // Json order
    for(var _node in results){
        ordered.push(results[_node]);
    }
    return ordered;
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
    return "/user:" + (win_config.domain ? win_config.domain + "\\" : "") + win_config.username;
}


var modules = {};

/*****************
 * Main functions
 * **************/
 
// Clusrun
/**
opts : {
    all                 - Run the command on all nodes
    nodes               :  Array of nodes
    exclude             : Array of nodes to exclude
    workdir             : Working directory for the command
}
**/
/**
 TODO:
    /env                 <variable_name1>=<value1> [;<variable_name2>=<value2>...]. 
    /interleaved         - Command output from different nodes are displayed interleaved
    /job                 - A Running/Finished/Failed/Cancelled job whose nodes will run the command
    /nodegroup           - Node group where the command will run on
    /nodestate           - Run the command on all nodes with specified state
    /outputdir           - Directory where command output will be saved
    /password            - Password of the specified user.
    /scheduler           - Cluster name.
    /sorted              - Command output from different nodes are displayed after command finishes on all nodes, in the order of node name
    /stdin               - Standard input file for the command.
    /task                - A Running/Finished/Failed/Cancelled task whose nodes will run the command
    /template            - A job template whose nodes will run the command
**/

modules.clusrun = function(win_config, cmd, opts, callback){
    var args = Array.prototype.slice.call(arguments);

    // first argument is the config file
    win_config = args.shift();

    // first argument is the config file
    cmd = args.shift();

    // last argument is the callback function
    callback = args.pop();
    
    var remote_cmd = cmdBuilder(win_config.binariesDir, cmdDict.clusrun);
    
    // Parse arguments
    if(args.length === 1){
        // Options
        opts = args.pop();
        // Working directory
        if(opts.workdir){
            remote_cmd.push("/workdir:" + opts.workdir);
        }
        // Nodes
        if(opts.nodes){
            if(!(Array.isArray(opts.nodes))){
                opts.nodes = [opts.nodes];
            }
            var nodeCmd = "/nodes:";
            for(var node in opts.nodes){
                nodeCmd += opts.nodes[node] + ",";
            }
            remote_cmd.push(nodeCmd);
        }
        // Exclude
        if(opts.exclude){
            if(!(Array.isArray(opts.exclude))){
                opts.exclude = [opts.exclude];
            }
            var excludeCmd = "/exclude:";
            for(var exclude in opts.exclude){
                excludeCmd += opts.exclude[exclude] + ",";
            }
            remote_cmd.push(excludeCmd);
        }
        if(opts.username){
            remote_cmd.push(insertUsername(opts));
        }
        if(opts.outputdir){
            remote_cmd.push("/outputdir:" + opts.outputdir);
        }
        
    }else{
        // Default is to run on all nodes
        opts = {all : true};
    }
    if(opts.all){
        remote_cmd.push("/all");
    }
    // Insert custom command
    remote_cmd.push(cmd);
    
    var output = spawnProcess(remote_cmd,"shell",null,win_config);
    // Transmit the error if any
    if (output.error){
        if(output.error.code === 'ETIMEDOUT' && output.stdout.startsWith('Enter the password for')){
            return callback(new Error("Password has not been saved, use hpccred to cache your password"));
        }else{
            return callback(output.error);
        }
    }
    var result = [];
    var stdout = output.stdout.trim().split(/\r\n\-+\s+Summary\s+\-+\r\n/mg);
    var summary = stdout[1].trim().match(/([0-9]+)\s+Nodes\s+succeeded\r\n([0-9]+)\s+Nodes\s+failed/);
    var cmdOutput = stdout[0].trim().split(/\-+\s+(.+)\s+returns\s+([0-9]+)\s+\-+\r\n/g);
    for(var i=1; i<cmdOutput.length; i+=3){
        result.push({
            node        :   cmdOutput[i],
            code        :   cmdOutput[i+1],
            output      :   cmdOutput[i+2]
        });
    }
    return callback(null, {
            success : summary[1],
            failure : summary[2],  
            result  : result
        });
};

// Return the Working Directory
modules.getJobWorkDir = function(win_config, jobId, callback){
    
    // Retrieve Path
    winFn.tasks(true, win_config, jobId, function(err,data){
        if(err){
            return callback(err);
        }
        
        // Loop on tasks and return on first one
        for(var task in data){
            var jobWorkingDir;
            try{
                jobWorkingDir = path.resolve(data[task].WorkDirectory);
            }catch(e){
                return callback(new Error("Working directory not found"));
            }
            
            return callback(null, jobWorkingDir);
        }
    });
};

// Create a unique working directory in the global working directory from the config
modules.createJobWorkDir = function(win_config, workdirName, callback){
    
    var args = Array.prototype.slice.call(arguments);

    // first argument is the config file
    win_config = args.shift();

    // last argument is the callback function
    callback = args.pop();
    
    var workDir;
    if(args.length === 1){
        // Takes a string to create the working directory
        workDir = args.pop();
    }else{
        // Generate a UID for the working dir
        workDir = createUID();
    }
    
    // Get configuration working directory and Generate a UID for the working dir
    var jobWorkingDir = path.join(win_config.workingDir,workDir);
    
    // Return a locally available job Directory
    var mountedWorkingDir = null;
    if (win_config.useSharedDir){
        mountedWorkingDir = path.join(win_config.sharedDir,workDir);
    }
    //Create workdir with 700 permissions
    var process = spawnProcess([win_shell, '/c', 'IF NOT EXIST ' + jobWorkingDir + ' ' + win_shell + ' /c mkdir ' +jobWorkingDir] ,"shell", null, win_config);
    
    // Transmit the error if any
    if (process.error){
        return callback(new Error(process.error));
    }
    
    //TODO:handles error
    // Return the UNC Path
    return callback(null, jobWorkingDir, mountedWorkingDir);
};

// Set credentials with plain-text password on command line
modules.wincreds = function(win_config, password, callback){
    
    var remote_cmd = cmdBuilder(win_config.binariesDir, cmdDict.setcreds);
    // User
    remote_cmd.push(insertUsername(win_config));
    
    // Password
    remote_cmd.push("/password:" + password);
    
    var output = spawnProcess(remote_cmd,"shell",null,win_config);
    // Transmit the error if any
    if (output.error){
        return callback(output.error);
    }

    return callback(null, 'Password successfully saved for ' + win_config.username);
};

// Interface for Win HPC NODE
/** winnodes(
    config          :   array of configuration parameters
    ps              :   powershell output
    controlCmd      :   online/offline
    nodeName        :   node to put on/off line or view info
    callback)
    
    Methods:
    Node list       :   winnodes(config, true/false, callback)
    Node info       :   winnodes(config, true/false, nodeName, callback)
    Node control    :   winnodes(config, true/false, controlCmd, nodeName, callback)
    
**/
winFn.nodes = function(ps, win_config, controlCmd, nodeName, callback){
    // controlCmd & nodeName are optionnal so we test on the number of args
    var args = Array.prototype.slice.call(arguments);
    
    // first argument is powershell flag and the config file
    ps = args.shift();    
    var node_prefix = "";
    if(ps === true){
        node_prefix = "ps";
    }
    win_config = args.shift();
    
    // last argument is the callback function
    callback = args.pop();
    
    var remote_cmd;
    var parseOutput = true;
    var singleNode = false;
    
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
            remote_cmd = cmdBuilder(win_config.binariesDir, cmdDict[node_prefix + "node"], nodeName);
            singleNode = true;
            break;
        default:
            // Default
            remote_cmd = cmdBuilder(win_config.binariesDir, cmdDict[node_prefix + "nodes"]);
    }
    
    var output = spawnProcess(remote_cmd,"shell",null,win_config);
    
    // Transmit the error if any
    if (output.error){
        return callback(output.error);
    }
    
    if (parseOutput){
        if(singleNode){
            // Parse info on a node
            return callback(null, jsonifyParam(output.stdout));
        }else{
            // Parse and save nodes
            var nodes = [];
            // Separate each node
            output = output.stdout.split(os.EOL + os.EOL);
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
};

// Interface for Win HPC Metric Value
/** psmetric(
    config          :   array of configuration parameters
    metricName      :   specific metric or all
    callback)
**/
modules.psmetric = function(win_config, metricName, callback){
    // controlCmd & nodeName are optionnal so we test on the number of args
    var args = Array.prototype.slice.call(arguments);

    // first argument is the config file
    win_config = args.shift();

    // last argument is the callback function
    callback = args.pop();
    
    var remote_cmd;
    // Metric or all
    switch (args.length){
        case 1:
            // Specific metric
            metricName = args.pop();
            remote_cmd = cmdBuilder(win_config.binariesDir, cmdDict.metric, metricName);
            break;
        default:
            // Default
            remote_cmd = cmdBuilder(win_config.binariesDir, cmdDict.metrics);
    }
    
    var output = spawnProcess(remote_cmd,"shell",null,win_config);
    
    // Transmit the error if any
    if (output.error){
        return callback(output.error);
    }
    
    // Parse info
    return callback(null, jsonifyMetrics(output.stdout));
};

// Interface for Win HPC JOBS
/** winjobs(
    config          :   array of configuration parameters
    jobId           :   job specific info
    callback)
    
    Methods:
    Job list        :   winjobs(config, callback)
    Job info       :    winjobs(config, jobId, callback)
    
**/
winFn.jobs = function(ps, win_config, jobId, callback){
    //TODO: Get all tasks info : Get-HpcJob -State All | Get-HpcTask
    // JobId is optionnal so we test on the number of args
    var args = Array.prototype.slice.call(arguments);
    // Boolean to indicate if we want the job list
    var jobList = true;
    
    // first argument is the config file
    ps = args.shift();
    var node_prefix = "";
    if(ps === true){
        node_prefix = "ps";
    }
    win_config = args.shift();

    // last argument is the callback function
    callback = args.pop();
    
    var remote_cmd;
    
    // Info on a specific job
    if (args.length == 1 && jobId !== 'all'){
        jobId = args.pop();
        remote_cmd = cmdBuilder(win_config.binariesDir, cmdDict[node_prefix + "job"], jobId);
        jobList = false;
    }else{
        remote_cmd = cmdBuilder(win_config.binariesDir, cmdDict[node_prefix + "jobs"]);
    }
    var output = spawnProcess(remote_cmd,"shell",null,win_config);
    
    // Transmit the error if any
    if (output.error){
        return callback(output.error);
    }
    // Job info or list
    if (jobList){
        output = output.stdout.trim().split(os.EOL + os.EOL);
        // Parse jobs
        var jobs = [];
        for (var j = 0; j < output.length; j++) {
            if(output[j].length > 1){
                jobs.push(jsonifyParam(output[j]));
            }
        }
        return callback(null, jobs);
    }else{
        return callback(null,jsonifyParam(output.stdout));
    }
};

// Interface for Win HPC Tasks
/** wintasks(
    config          :   array of configuration parameters
    jobName         :   task for the job
    callback)
    
    Methods:
    Job list        :   winjobs(config, callback)
    Job info       :    winjobs(config, jobName, callback)
    
**/
winFn.tasks = function(ps, win_config, jobId, callback){
    var node_prefix = "";
    if(ps === true){
        node_prefix = "ps";
    }
    var remote_cmd;
    
    remote_cmd = cmdBuilder(win_config.binariesDir, cmdDict[node_prefix + "task"], jobId);
    
    var output = spawnProcess(remote_cmd,"shell",null,win_config);
    
    // Transmit the error if any
    if (output.error){
        return callback(output.error);
    }
    
    // Task list
    output = output.stdout.trim().split(os.EOL + os.EOL);
    
    // Parse jobs
    var tasks = [];
    for (var j = 0; j < output.length; j++) {
        if(output[j].length > 1){
            tasks.push(jsonifyParam(output[j]));
        }
    }
    
    return callback(null, tasks);
        
};
// Generate the script to run the job and write it to the specified path
// Workdir has to be specified, WinHPC does not allow jobfile and workdir
// Job Arguments taken in input : TO COMPLETE
// Return the full path of the SCRIPT
/* jobArgs = {
    jobName         :   String      //  'Name="My Task"'
    taskName         :   String     //   Array of task names (optional)
    resources       :   String      //  'UnitType="Core" MinCores="1" MaxCores="1"'
    walltime        :   String      //  'RuntimeSeconds="10860"'
    queue           :   String      //  'NodeGroups="AzureNodes,ComputeNode"'
    reqNodes        :   Array       //  'RequestedNodes="HEADNODE,NODE1"'
    workdir         :   String      //  'WorkDirectory="workDirPath"' || Array of task workdir
    stdout          :   String      //  'StdOutFilePath="outFile"' || Array of task stdout
    stderr          :   String      //  'StdErrFilePath="errFile"' || Array of task stderr
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
modules.winscript = function(jobArgs, localPath, callback){
    
    var toWrite = '<?xml version="1.0" encoding="utf-8"?>' + os.EOL;
    toWrite += '<Job';
    
    var jobName = jobArgs.jobName;
    
    // The name has to be bash compatible: TODO expand to throw other erros
    if (jobName.search(/[^a-zA-Z0-9]/g) !== -1){
        return callback(new Error('Name cannot contain special characters'));
    }

    // Single task name or not provided
    if(!jobArgs.taskName){
        jobArgs.taskName = jobArgs.jobName.toString();
    }
    // Per-task parameters or global
    if(!(Array.isArray(jobArgs.commands))){
        jobArgs.commands = [jobArgs.commands];
    }
    // Translate each parameter into an array of same size as commands
    var perTaskCmds = ["taskName", "workdir", "stdout", "stderr"];
    perTaskCmds.forEach(function(k){
        if(!(Array.isArray(jobArgs[k]))){
            jobArgs[k] = new Array(jobArgs.commands.length).fill(jobArgs[k]);
        }
    });
    
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
    
    // Requested Nodes optional
    if (jobArgs.reqNodes !== undefined && jobArgs.reqNodes !== ''){
        if(!(Array.isArray(jobArgs.reqNodes))){
            jobArgs.reqNodes = [jobArgs.reqNodes];
        }
        toWrite += ' RequestedNodes="';
        var firstNode = true;
        for(var reqNode in jobArgs.reqNodes){
            if(!firstNode){
                toWrite += ",";
            }
            toWrite += jobArgs.reqNodes[reqNode];
            firstNode = false;
        }
        toWrite += '"';
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
    toWrite += '>' + os.EOL;
    
    // EnvironmentVariables
    if(jobArgs.env){
        toWrite += '\t<EnvironmentVariables>' + os.EOL;
        
        for(var _env in jobArgs.env){
            toWrite += '\t\t<Variable>' + os.EOL;
            toWrite += '\t\t\t<Name>' + _env + '</Name>' + os.EOL;
            toWrite += '\t\t\t<Value>' + jobArgs.env[_env] + '</Value>' + os.EOL;
            toWrite += '</Variable>' + os.EOL;
        }
        
        // Close
        toWrite += '\t</EnvironmentVariables>' + os.EOL;
    }
    
    // Tasks
    toWrite += '\t<Tasks>' + os.EOL;
    
    // Loop on tasks
    for(var task in jobArgs.commands){
        toWrite += '\t\t<Task';
        // Resources
        toWrite += jobArgs.resources;
        toWrite += ' Name="' + jobArgs.taskName[task] + '"';
        // Workdir
        toWrite += ' WorkDirectory="' + jobArgs.workdir[task] + '"';
        //Stdout and err
        toWrite += ' StdOutFilePath="' + jobArgs.stdout[task] + '" StdErrFilePath="' + jobArgs.stderr[task] + '"';
        //Command
        toWrite += ' CommandLine="' + jobArgs.commands[task] + '"';
        //End
        toWrite += ' />' + os.EOL;
    }
    // End tasks
    toWrite += '\t</Tasks>' + os.EOL + '</Job>';
    
    // Write to script, delete file if exists
    fs.unlink(scriptFullPath, function(err){
        // Ignore error if no file
        if (err && err.code !== 'ENOENT'){
            return callback(new Error("Cannot remove the existing file."));
        }
        fs.writeFileSync(scriptFullPath,toWrite);
        
        return callback(null, {
            "message"   :   'Script for job ' + jobName + ' successfully created',
            "path"      :   scriptFullPath
        });
    });
};


// Interface for job modify
// Modify job parameters inline
// winmodify(
/*    
        pbs_config      :   config,
        jobId           :   jobId,
        jobSettings     :  {
            jobName     :   string
            priority    :   -1024 < n < 1023
        },
        callack(err, success)
}
*/
modules.winmodify = function(win_config, jobId, jobSettings, callback){
    var remote_cmd = cmdBuilder(win_config.binariesDir, cmdDict.modify, jobId);
    
    // Job name
    if(jobSettings.jobName){
        remote_cmd.push('/jobname:' + jobSettings.jobName);
    }
    // Priority
    if(jobSettings.priority){
        // Parse number
        jobSettings.priority = Math.max(Math.min(Number(jobSettings.priority), 4000), 0);
        remote_cmd.push('/priority:' + jobSettings.priority);
    }
    
    // Submit
    var output = spawnProcess(remote_cmd,"shell",null,win_config);
    
    // Transmit the error if any
    if (output.error){
        return callback(output.error);
    }
    
    return callback(null, 'Job ' + jobId + ' successfully modified');
};

// Interface for job submit
// Submit a script by its absolute path
// winsubmit(
/*    
        win_config      :   config,
        jobArgs         :   array of required files to send to the server with the script in 0,
        jobWorkingDir   :   working directory,
        callack(message, jobId, jobWorkingDir)
}
*/
modules.submit = function(win_config, jobArgs, jobWorkingDir, callback){
    
    if(jobArgs.length < 1) {
        return callback(new Error('Please submit the script to run'));  
    }
    
    // Send files by the copy command defined
    // for (var i = 0; i < jobArgs.length; i++){
    //     // Copy only different files
    //     if(path.normalize(jobArgs[i]) !== path.join(jobWorkingDir, path.basename(jobArgs[i]))){
    //         var copyCmd = spawnProcess([jobArgs[i],jobWorkingDir],"copy","send",win_config);
    //         if (copyCmd.error){
    //             return callback(new Error(copyCmd.error));
    //         }
    //     }
    // }
    
    // Add script: first element of qsubArgs
    var scriptName = path.basename(jobArgs[0]);
    // Use clusrun to submit job as running user
    var submitCmd = cmdBuilder(win_config.binariesDir, cmdDict["submit"], scriptName);
    submitCmd[0] = "\"" + submitCmd[0] + "\"";
    
    modules.clusrun(win_config, submitCmd.join(' '), 
        {
            workdir     :   jobWorkingDir,
            username    :   win_config.username,
            domain      :   win_config.domain,
            nodes       :   win_config.headnode
        }, function(err, stdout){
            if (err){
                return callback(err);
            }
            
            // Catch job Id
            var jobId = stdout.result[0].output.match(/.+?\:\s*([0-9]+)/)[1];
            
            return callback(null, { 
                    "message"   : 'Job ' + jobId + ' submitted',
                    "jobId"     : jobId,
                    "path"      : jobWorkingDir
                });
        });
};

modules.psgroups = function(win_config, groupName, callback){
    // groupName is optionnal so we test on the number of args
    var args = Array.prototype.slice.call(arguments);
    
    // first argument is the config file
    win_config = args.shift();

    // last argument is the callback function
    callback = args.pop();
    
    var remote_cmd;
    var groupList = true;
    
    // Info on a specific job
    if (args.length == 1){
        groupName = args.pop();
        remote_cmd = cmdBuilder(win_config.binariesDir, cmdDict.group, groupName);
    }else{
        remote_cmd = cmdBuilder(win_config.binariesDir, cmdDict.groups);
    }
    var output = spawnProcess(remote_cmd,"shell",null,win_config);
    
    // Transmit the error if any
    if (output.error){
        return callback(output.error);
    }
    
    // Group info or list
    if (groupList){
        output = output.stdout.trim().split(os.EOL + os.EOL);
        // Parse groups
        var groups = [];
        for (var j = 0; j < output.length; j++) {
            groups.push(jsonifyParam(output[j]));
        }
        return callback(null, groups);
    }else{
        return callback(null,jsonifyParam(output.stdout));
    }
};

// Interface for Stop-hpcjob
// Delete the specified job Id and return the message and the status code
winFn.cancel = function(ps, win_config, jobId, callback){
    // JobId is optionnal so we test on the number of args
    var args = Array.prototype.slice.call(arguments);

    // first argument is the config file
    ps = args.shift();
    var node_prefix = "";
    if(ps === true){
        node_prefix = "ps";
    }
    win_config = args.shift();

    // last argument is the callback function
    callback = args.pop();
    
    var remote_cmd;
    
    if (args.length !== 1){
        // Return an error
        return callback(new Error('Please specify the jobId'));
    }else{
        jobId = args.pop();
        remote_cmd = cmdBuilder(win_config.binariesDir, cmdDict[node_prefix + "cancel"], jobId);
    }
    
    var output = spawnProcess(remote_cmd,"shell",null,win_config);
    
    // Transmit the error if any
    if (output.error){
        return callback(output.error);
    }
    // Job deleted returns
    return callback(null, {"message" : 'Job ' + jobId + ' successfully deleted'});
};

// Display server info
modules.mgr_js = function(win_config, mgrCmd, callback){
    
    
    return callback(null, mgrInfo);
};

modules.windir = function(win_config, jobId, callback){
    // Check if the user is the owner of the job
    modules.getJobWorkDir(win_config, jobId, function(err, jobWorkingDir){
        if(err){
            return callback(err);
        }
        // TOOD: put in config file
        var remote_cmd = ["dir", "/s", jobWorkingDir];
        var output = spawnProcess(remote_cmd,"shell",null,win_config,{shell : true});
        
        // Transmit the error if any
        if (output.error){
            return callback(output.error);
        }
        output.stdout = output.stdout.split(os.EOL + os.EOL);
        
        var fileList        = [];
        fileList.files      = [];
        fileList.folders    = [];
        
        //Loop on folders, first line is header, last line is summary
        for(var folder=1;folder<output.stdout.length-1;folder+=2){
            // Directory
            var folderPath = output.stdout[folder].match(dirRegEx)[1];
            fileList.folders.push(folderPath);
            
            // Loop on files
            var files = output.stdout[folder+1].split(os.EOL);
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
};

modules.winretrieve = function(win_config, jobId, fileList, localDir, callback){
    
    return callback(null,{
            "message"   : 'Files for the job ' + jobId + ' have all been retrieved in ' + localDir
        });

};

// Create a "win" (Command prompt) version and a "ps" (Powershell) version
var declareFn = function (_f) {
    modules["win" + _f] = function(){
        var args = Array.prototype.slice.call(arguments);
        args.unshift(false);
        return winFn[_f].apply(this, args);
    };
    modules["ps" + _f] = function(){
        var args = Array.prototype.slice.call(arguments);
        args.unshift(true);
        return winFn[_f].apply(this, args);
    };
};

for(var fn in winFn){
    declareFn(fn);
}

// END
module.exports = modules;