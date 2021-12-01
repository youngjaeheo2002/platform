import { dsvFormat } from 'd3-dsv';
import { Data, Assignments } from '/collections';

String.prototype.toPascalCase = function() {
  return this
    .replace(/\s(.)/g, function($1) { return $1.toUpperCase(); })
    .replace(/\s/g, '');
}

// This should stay Float32Array, as this is required for the use of
// WebAudio features for digital signal processing in the frontend,
// see https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer/copyToChannel
const FloatArrayType = Float32Array;

const exec = Npm.require('child_process').exec;
const runCommand = Meteor.wrapAsync(exec);
const runWFDBCommand = (command, runInDirectory = '') => {
  console.time('runWFDBCommand');
  let WFDBCommand = command;
  const EDFDir = process.env.EDF_DIR + runInDirectory;
  if (EDFDir) {
    WFDBCommand = 'WFDB="' + EDFDir + '" ' + WFDBCommand;
  }
  console.log('WFDBCommand:', WFDBCommand);
  const output = runCommand(WFDBCommand, { maxBuffer: 2048 * 500 * 10, cwd: EDFDir });
  console.timeEnd('runWFDBCommand');
  return output;
};

const isAssignedToEDF = (userId, filePath) => {
  const dataIds = Data.find({ path: filePath }, { fields: { _id: 1 } }).fetch().map(doc => doc._id);
  const numAssignments = Assignments.find({ users: userId, dataFiles: { $in: dataIds } }).count();
  return numAssignments > 0;
};

let WFDB = {
  wfdbdesc (recordingFilePath) {
    const isCallFromClient = !!this.connection;
    if (isCallFromClient && !isAssignedToEDF(Meteor.userId(), recordingFilePath)) {
      throw new Meteor.Error('wfdb.wfdbdesc.command.permission.denied', 'You are not assigned to this recording. Permission denied.');
    }
    try {
      
      const recordingPathSegments = recordingFilePath.split('/');
      const recordingFilename = recordingPathSegments[recordingPathSegments.length - 1];
      delete recordingPathSegments[recordingPathSegments.length - 1];
      const recordingDirectory = recordingPathSegments.join('/');
      return runWFDBCommand('wfdbdesc "' + recordingFilename + '"', recordingDirectory);
    }
    catch (e) {
      throw new Meteor.Error('wfdb.wfdbdesc.command.failed', e.message);
    }
  },
  rdsamp (options) {
    console.log("rdsamp started");
    const isCallFromClient = !!this.connection;
    if (isCallFromClient && !isAssignedToEDF(Meteor.userId(), options.recordingName)) {
      console.log("Access denied");
      throw new Meteor.Error('wfdb.rdsamp.command.permission.denied', 'You are not assigned to this recording. Permission denied.');
    }
    // console.time('rdsamp');
    try {
      // console.log("try");
      const useHighPrecisionSamplingString = options.useHighPrecisionSampling ? ' -P' : ' -p';
      console.log("options.recordingName:", options.recordingName);
      const recordingPathSegments = options.recordingName.split('/');
      const recordingFilename = recordingPathSegments[recordingPathSegments.length - 1];
      delete recordingPathSegments[recordingPathSegments.length - 1];
      const recordingDirectory = recordingPathSegments.join('/');
      const downsampledFileName = recordingFilename.substring(0, recordingFilename.length - 4) + '_downsampled';
      const downsampledFile = downsampledFileName + '.dat';
      const downsampledHeaderFile = downsampledFileName + '.hea';
      
      var signalRawOutput = null;
      if (options.windowLength <= 304) {
        // if the x-axis scale is less then 5 mins/page (+4 sec padded)
        // rdsamp the original high sampling rate .edf file
        signalRawOutput = runWFDBCommand('rdsamp -r "' + recordingFilename + '" -f ' + options.startTime + ' -l ' + options.windowLength + useHighPrecisionSamplingString + ' -c -H -v -s ' + options.channelsDisplayed.join(' '), recordingDirectory);
      } else {
        let downsampledExists = runWFDBCommand(`test -f "${downsampledFile}" && test -f "${downsampledHeaderFile}" && echo "t" || echo "f"`, recordingDirectory).replace(/\r?\n/, '');
        if (downsampledExists != 't') {
          throw new Meteor.Error('wfdb.rdsamp.command.downsampled.file.missing', 'The downsampled file .dat or its header file .hea is missing, please reload the page and try again later.');
        }
        // rdsamp the downsampled .dat file with lower sampling rate
        signalRawOutput = runWFDBCommand('rdsamp -r "' + downsampledFileName + '" -f ' + options.startTime + ' -l ' + options.windowLength + useHighPrecisionSamplingString + ' -c -H -v -s ' + options.channelsDisplayed.join(' '), recordingDirectory);
      }
      // console.time('parseRawOutput');
      let rows = dsvFormat(',').parseRows(signalRawOutput);
      const columnNames = rows[0].map((value) => {
        return value.substr(1).slice(0, -1);
      });
      const channelNames = columnNames.slice(1);
      // console.log("rows[0]:", rows[0], "\ncolumnNames:", columnNames);
      // comsole.log('\nchannelNames:', channelNames);
      rows.shift();
      const columnUnits = rows[0].map((value) => {
        return value.substr(1).slice(0, -1);
      });
      const channelUnits = columnUnits.slice(1);
      // console.log("rows[0]:", rows[0], "\ncolumnUnits:", columnUnits); 
      // console.log("\nchannelUnits", channelUnits); 
      rows.shift();
      const numSamplesRaw = rows.length;
      const lastSampleIndex = numSamplesRaw - 1;
      const outputStartTimeInSeconds = parseFloat(rows[0][0]);
      const outputEndTimeInSeconds = parseFloat(rows[lastSampleIndex][0]);
      const outputDurationInSeconds = outputEndTimeInSeconds - outputStartTimeInSeconds;
      const samplingRateRaw = numSamplesRaw / outputDurationInSeconds;
      let downSamplingFactor = 0;
      if (options.targetSamplingRate > 0) {
        downSamplingFactor = Math.round(samplingRateRaw / options.targetSamplingRate);
      }
      if (downSamplingFactor > 1) {
        rows = rows.filter((row, r) => {
          return (r % downSamplingFactor !== 0);
        });
      }
      const numSamples = rows.length;
      const samplingRate = Math.round(numSamples / outputDurationInSeconds);
      const data = channelNames.map(() => {
        return new FloatArrayType(numSamples);
      });
      rows.forEach((row, r) => {
        // ignore first column (elapsed time)
        row.shift();
        row.forEach((value, c) => {
          if (value === '-') {
            value = 0.0;
          }
          else {
            value = parseFloat(value);
          }
          data[c][r] = value;
        })
      });
      let dataFrame = {
        channelNames: channelNames,
        data: data,
        startTime: outputStartTimeInSeconds,
        endTime: outputEndTimeInSeconds,
        duration: outputDurationInSeconds,
        numSamples: numSamples,
        samplingRate: samplingRate,
      };
      // console.timeEnd('parseRawOutput');
      // console.timeEnd('rdsamp');
      return dataFrame; 
    }
    catch (e) {
      // console.timeEnd('rdsamp');
      if (e.message.split('\n')[1] !== undefined && e.message.split('\n')[1].trim() == '') {
        return {
          numSamples: 0,
        };
      }
      else {
        throw new Meteor.Error('wfdb.rdsamp.command.failed', e.message);
      }
    }
  },
  downsamp (options) {
    const isCallFromClient = !!this.connection;
    if (isCallFromClient && !isAssignedToEDF(Meteor.userId(), options.recordingName)) {
      throw new Meteor.Error('wfdb.rdsamp.command.permission.denied', 'You are not assigned to this recording. Permission denied.');
    }
    try {
      const recordingPathSegments = options.recordingName.split('/');
      const recordingFilename = recordingPathSegments[recordingPathSegments.length - 1];
      delete recordingPathSegments[recordingPathSegments.length - 1];
      const recordingDirectory = recordingPathSegments.join('/');

      const downsampledFileName = recordingFilename.substring(0, recordingFilename.length - 4) + '_downsampled';
      const downsampledFile = downsampledFileName + '.dat';
      const downsampledHeaderFile = downsampledFileName + '.hea';
      console.log('filenames:', downsampledFileName, downsampledFile, downsampledHeaderFile);
      
      // setup the low resolution file if it does not exist
      let downsampledExists = runWFDBCommand(`test -f "${downsampledFile}" && test -f "${downsampledHeaderFile}" && echo "t" || echo "f"`, recordingDirectory).replace(/\r?\n/, '');
      console.log(`downsampledExists: "${downsampledExists}"`);
      
      if (downsampledExists != 't') {
        // create a header file .hea (https://www.physionet.org/physiotools/wag/header-5.htm)
        // then downsample the recording using xform (https://www.physionet.org/physiotools/wag/xform-1.htm)
        // it will create downsampled file in mit format (.dat + .hea)
        
        let metadata = options.recordingMetadata;
        let headerFile = [];

        // set the sampling frequency to targetDownsamplingRate
        // and the number of samples per signal to zero to turn off the checksum verification
        let recordLine = [downsampledFileName, metadata.Groups[0].Signals.length, options.targetDownsamplingRate, 0];
        let recordingTimeAndDate = metadata.StartingTime.slice(1, -1);
        recordLine.push(recordingTimeAndDate);
        headerFile.push(recordLine.join(' '));

        metadata.Groups[0].Signals.forEach((signal) => {
          let signalLine = [downsampledFile];
          signalLine.push(signal.StorageFormat.match(/[0-9.]+/)[0]);
          let adc = signal.Gain.replace(' adu', '(' + signal.Baseline + ')').match(/[\S]+/);
          signalLine.push(adc);
          signalLine.push(signal.ADCResolution.match(/[0-9.]+/)[0]);
          signalLine.push(signal.ADCZero);
          signalLine.push(signal.InitialValue);
          signalLine.push('0'); // set the checksum to 0 as a placeholder
          signalLine.push('0');
          signalLine.push(signal.Description);
          headerFile.push(signalLine.join(' '));
        });

        // write into the header file and perform xform to downsample
        const modifiedHeader = headerFile.join('\r\n');
        runWFDBCommand(`echo "${modifiedHeader}" > ${downsampledHeaderFile}`, recordingDirectory);
        runWFDBCommand(`xform -i "${recordingFilename}" -H -o "${downsampledHeaderFile}"`, recordingDirectory);
      }
    } catch (e) {
      if (e.message.split('\n')[1] !== undefined && e.message.split('\n')[1].trim() == '') {
        return {
          numSamples: 0,
        };
      }
      else {
        throw new Meteor.Error('wfdb.downsamp.command.failed', e.stack);
      }
    }
  }
}

let isInteger = (expression) => {
  return expression == '' + parseInt(expression);
}
/*
let filterName = (allSignals) => {
  returnSignals = [];

  allSignals.forEach((fixSignal) => {
  if(fixSignal.){

  }
  });
  return returnSignals = [];

}
*/
let parseComputedChannelString = (computedChannelString, recordingId) => {
  const parts = computedChannelString.split('=');
  const channelName = parts[0].trim();
  let channelKey;
  let functionParameters;
  let functionName;
 if(parts.length > 1 ){
    const formula = parts[1].trim();
    const formulaParts = formula.split('(');
    
    if (formulaParts.length == 1) {
      functionName = 'IDENTITY';
      functionParameters = [ { name: formulaParts[0], dataId: recordingId } ];
      channelKey = functionParameters[0].name;
    }
    else {
      functionName = formulaParts[0];
      functionParameters = formulaParts[1].slice(0, -1).split(',').map((parameter) => { return { name: parameter.trim(), dataId: recordingId }; })
      channelKey = functionName + '(' + functionParameters.map((parameter) => parameter.name).join(',') + ')';
    }
  
  
  let individualChannelsRequired;
  switch (functionName) {
    case 'MEAN':
    case 'IDENTITY':
      individualChannelsRequired = functionParameters;
      break;
    default:
      throw new Meteor.Error('get.edf.data.computed.channel.unknown.function', 'Unknown function name for computed channel: ' + functionName);
      break;
  }
}
  else{
    functionName = 'IDENTITY';
    functionParameters = [ { name: channelName, dataId: recordingId } ];
    channelKey = functionParameters[0].name;
    individualChannelsRequired = functionParameters;
  }
  return {
    computed: true,
    channelName: channelName,
    channelKey: channelKey,
    functionName: functionName,
    functionParameters: functionParameters,
    individualChannelsRequired: individualChannelsRequired,
  }
}

let computeChannelData = (computedChannel, dataFrame, subtractionOrder, dataId) => {
  const functionName = computedChannel.functionName;
  switch (functionName) {
    case 'MEAN':
      let computedChannelData = new FloatArrayType(dataFrame.numSamples);
      computedChannelData.fill(0);
      computedChannel.functionParameters.forEach((functionParameter) => {
        const channelIndex = indexOfChannel(subtractionOrder, functionParameter, dataId);
        const channelData = dataFrame.data[channelIndex].data;
        computedChannelData = computedChannelData.map((value, v) => { return value + channelData[v]; });
      });
      const numChannelsToAverage = computedChannel.functionParameters.length;
      if (numChannelsToAverage > 1) {
        computedChannelData = computedChannelData.map((value) => { return value / numChannelsToAverage; });
      }
      return computedChannelData;
    case 'IDENTITY':
      const channelIndex = indexOfChannel(subtractionOrder, computedChannel.functionParameters[0], dataId);
      const channelData = dataFrame.data[channelIndex].data;
      return channelData;
    default:
      throw new Meteor.Error('get.edf.data.computed.channel.unknown.function', 'Unknown function name for computed channel: ' + functionName);
      break;
  }
}

let parseChannelsDisplayed = (channelsDisplayed, recordingId) => {
  individualChannelsRequired = new Set();
  var individualChannels= [];
  
  let channelsDisplayedParsed = {
    subtractions: [],
  }
  
  channelsDisplayed.forEach((channel) => {
    const channelString = '' + channel;
    const channelParts = channelString.split('-');
    const subtraction = {
      key: channelString,
      dataId: recordingId,
      plus: undefined,
      minus: undefined,
    }
    
    channelsDisplayedParsed.subtractions.push(subtraction);
    let operandNames = ['plus', 'minus']
    channelParts.forEach((channelPart, c) => {
      if (channelPart === '') {
        return;
      }
      let operandName = operandNames[c];
      if (isInteger(channelPart)) {
        subtraction[operandName] = channelPart;
        individualChannelsRequired.add({ name: subtraction[operandName], dataId: recordingId });
        
      }
      else {
        
        individualChannels = [];
        var count = 15;
        channelsDisplayed.forEach((myChannel) => {
        
          count++;
          computedChannel = parseComputedChannelString(myChannel, recordingId);
          
         (computedChannel.individualChannelsRequired).forEach((r) => {
            
            individualChannels.push(r)
           
          })
        });

          }
        });
      })

 
  

  channelsDisplayedParsed.individualChannelsRequired = individualChannels;
  
  return channelsDisplayedParsed;
};

let parseWFDBMetadata = (metadata) => {
  let overallAndSignals = metadata.split('\nGroup ');
  let overall = overallAndSignals[0];
  let signals = overallAndSignals.splice(1);
  let metadataParsed = {}
  overAllKeyValuePairs = overall.split('\n');
  overAllKeyValuePairs.forEach((keyValuePair, k) => {
    if (k == overAllKeyValuePairs.length - 1) {
      return;
    }
    keyValuePair = keyValuePair.split(': ');
    if (keyValuePair.length == 1) {
      keyValuePair = keyValuePair[0].split(' ');
    }
    let key = keyValuePair[0].trim().toPascalCase();
    let value = keyValuePair[1].trim();
    metadataParsed[key] = value;
    if (key == 'Length') {
      let valueInSeconds = value.split(' ')[0];
      let lengthInSeconds = 0;
      let milliSecondsAndAbove = valueInSeconds.split('.')
      let milliSeconds = parseInt(milliSecondsAndAbove[1]);
      lengthInSeconds += milliSeconds / 1000.0;
      let aboveMilliSeconds = milliSecondsAndAbove[0].split(':');
      aboveMilliSeconds.reverse();
      aboveMilliSeconds.forEach((v, i) => {
        lengthInSeconds += v * Math.pow(60, i);
      });
      metadataParsed.LengthInSeconds = lengthInSeconds;
    }
  });
  let currentGroupIndex = -1;
  let groups = [];
  let group;
  metadataParsed.Groups = groups;
  signals.forEach((signal, s) => {
    let keyValuePairs = signal.split('\n');
    let groupAndSignalIndices = keyValuePairs[0];
    keyValuePairs = keyValuePairs.splice(1);
    groupAndSignalIndices = groupAndSignalIndices.split(', ');
    let groupIndex = parseInt(groupAndSignalIndices[0]);
    if (groupIndex > currentGroupIndex) {
      currentGroupIndex = groupIndex;
      group = {
        Signals: [],
        SignalsByName: {},
      };
      groups.push(group);
    }
    let signalIndex = parseInt(groupAndSignalIndices[1].split(':')[0].split(' ')[1]);
    let signalParsed = {};
    signalParsed.Group = groupIndex;
    signalParsed.Signal = signalIndex;
    keyValuePairs.forEach((keyValuePair) => {
      keyValuePair = keyValuePair.split(': ');
      if (keyValuePair.length == 1) {
        return;
      }
      let key = keyValuePair[0].trim().toPascalCase();
      if (key == 'I/O') {
        key = 'IO';
      }
      let value = keyValuePair[1].trim();
      signalParsed[key] = value;
    });
    group.Signals.push(signalParsed);
    group.SignalsByName[signalParsed.Description] = signalParsed;
  });
  return metadataParsed;
}

let convertEntriesToTypedFloatArrays = (dict) => {
  let dictTyped = {};
  for (key in dict) {
    dictTyped[key] = new FloatArrayType(dict[key]);
  }
  return dictTyped;
}

var isChannel = function(element) {
  if (!this || !this.name || !this.dataId) return false;
  if (!element.name || !element.dataId) throw new TypeError(`Argument is not a channel array`);
  return (element.name === this.name && element.dataId === this.dataId);
};

function indexOfChannel(channelArray, index, dataId) {
  if (!channelArray || !Array.isArray(channelArray)) {
    throw new TypeError(`Argument is not a channel array`);
  }
  return channelArray.findIndex(isChannel, { name: index, dataId: dataId });
};

Meteor.methods({
  'get.edf.metadata' (allRecordings) {
    let lengthInSeconds = 0;
    let allMetadata = {};
    allRecordings.forEach((recording) => {
      let metadata = parseWFDBMetadata(WFDB.wfdbdesc(recording.path));
      if (metadata.LengthInSeconds > lengthInSeconds) {
        lengthInSeconds = metadata.LengthInSeconds;
      }
      allMetadata[recording._id] = metadata;
    });
    console.log(allMetadata, lengthInSeconds);
    return {
      allMetadata,
      lengthInSeconds,
    }
  },
  'get.edf.data' (options) {
    console.log('get.edf.data');
    options = options || {};
    // options2 = options2 || {};
    let startTime = options.start_time || 0;
    let windowLength = options.window_length;
    let count = 0;
    let channelsDisplayed = options.channels_displayed;
    // let channelsDisplayed2 = options2.channels_displayed;
    let channelTimeshift = options.channel_timeshift;
    let allRecordings = options.recordings;
    allRecordings = allRecordings.map((recording) => {
      recording.channelsDisplayedParsed = parseChannelsDisplayed(channelsDisplayed[recording._id], recording._id);
      return recording;
    });
    // let channelsDisplayedParsed = parseChannelsDisplayed(channelsDisplayed);
    // let channelsDisplayedParsed2 = parseChannelsDisplayed(channelsDisplayed2);
    // let recordingName2 = options2.recording_name;
    let targetSamplingRate = options.target_sampling_rate;
    let useHighPrecisionSampling = options.use_high_precision_sampling;
    let atLeast1 = 0;
    let dataFrame = {};
    // let dataFrame2 = {};
    
    console.log("get.edf.data init finished");
    
    var currDataFrame;
    dataFrame = allRecordings.reduce((collections, recording) => {
      let startTimeAfterAdjustment = channelTimeshift[recording._id] ? (startTime + channelTimeshift[recording._id]) : startTime;
      currDataFrame = WFDB.rdsamp({
        recordingName: recording.path,
        startTime: startTimeAfterAdjustment,
        windowLength,
        channelsDisplayed: recording.channelsDisplayedParsed.individualChannelsRequired.map((channel) => channel.name),
        targetSamplingRate,
        useHighPrecisionSampling,
      });
      // currDataFrame.data = { [recording._id]: currDataFrame.data };
      currDataFrame.channelInfo = currDataFrame.channelNames.map((channelName) => {
        return { name: channelName, dataId: recording._id };
      });
      delete currDataFrame.channelNames;
      currDataFrame.data = currDataFrame.data.map((data) => {
        return { data: data, dataId: recording._id };
      });
      if (!Object.keys(collections).length) return currDataFrame;
      collections.channelInfo = collections.channelInfo.concat(currDataFrame.channelInfo);
      collections.data = collections.data.concat(currDataFrame.data);
      collections.startTime = Math.min(collections.startTime, currDataFrame.startTime);
      collections.endTime = Math.max(collections.endTime, currDataFrame.endTime);
      collections.duration = Math.max(collections.duration, currDataFrame.duration);
      collections.numSamples = Math.max(collections.numSamples, currDataFrame.numSamples);
      collections.samplingRate = Math.min(collections.samplingRate, currDataFrame.samplingRate);
      return collections;
    }, {});

    // dataFrame = WFDB.rdsamp({
    //   recordingName,
    //   startTime,
    //   windowLength,
    //   channelsDisplayed: channelsDisplayedParsed.individualChannelsRequired,
    //   targetSamplingRate,
    //   useHighPrecisionSampling,
    // });
    // console.log("dataFrame1 loaded");

    // let temprName = recordingName;
    // recordingName = recordingName2;
    // dataFrame2 = WFDB.rdsamp({
    //   recordingName: recordingName2,
    //   startTime,
    //   windowLength,
    //   channelsDisplayed: channelsDisplayedParsed2.individualChannelsRequired,
    //   targetSamplingRate,
    //   useHighPrecisionSampling,
    // });
    // console.log("dataFrame2 loaded ");

    // Combine two channel sets
    // dataFrame2.channelNames.forEach( channel => {
    //   dataFrame.channelNames.push(channel);
    // });
      
    // dataFrame2.data.forEach( dataSet => {
    //   dataFrame.data.push(dataSet);
    // })
    // dataFrame.numSamples += dataFrame2.numSamples;
    // // recordingName = temprName;
    // console.log("dataFrame combined channel:", dataFrame.channelNames);

    if (dataFrame.numSamples == 0) {
      return {};
    }
    // console.time('computeSubtractions');
    let channelsDisplayedParsed = allRecordings.reduce((parsedCombined, recording) => {
      if (!Object.keys(parsedCombined).length) return recording.channelsDisplayedParsed;
      parsedCombined.subtractions = parsedCombined.subtractions.concat(recording.channelsDisplayedParsed.subtractions);
      parsedCombined.individualChannelsRequired = parsedCombined.individualChannelsRequired.concat(recording.channelsDisplayedParsed.individualChannelsRequired);
      return parsedCombined;
    }, {});

    // channelsDisplayedParsed.subtractions = channelsDisplayedParsed.subtractions.concat(channelsDisplayedParsed2.subtractions);
    // channelsDisplayedParsed.individualChannelsRequired = channelsDisplayedParsed.individualChannelsRequired.concat(channelsDisplayedParsed2.individualChannelsRequired);
    console.log("channelsDisplayedParsed:", channelsDisplayedParsed);
    let subtractionOrder = channelsDisplayedParsed.individualChannelsRequired;
    // let channelNames = dataFrame.channelNames;
    let allChannelInfo = dataFrame.channelInfo;

    channelsDisplayedParsed.subtractions.forEach((subtraction) => {
      let dataId = subtraction.dataId;
      if (indexOfChannel(subtractionOrder, subtraction.key, dataId) > -1) return;
      // if (subtractionOrder[dataId].indexOf(subtraction.key) > -1) {
      //   return;
      // }
      let has = {};
      let channelIndex = {};
      let channelName = {};
      let channelData = {};
      ['plus', 'minus'].forEach((operandName) => {
        let operand = subtraction[operandName];
        has[operandName] = operand !== undefined;
        if (!has[operandName]) {
          return;
        }
        if (operand.computed) {
          if (indexOfChannel(subtractionOrder, operand.channelKey, dataId) < 0) {
            let computedChannelData = computeChannelData(operand, dataFrame, subtractionOrder, dataId);
            allChannelInfo.push({ name: operand.channelKey, dataId: dataId });
            subtractionOrder.push({ name: operand.channelKey, dataId: dataId });
            dataFrame.data.push({ data: computedChannelData, dataId: dataId });
          }
          let channelIndex = indexOfChannel(subtractionOrder, operand.channelKey, dataId);
          channelData[operandName] = dataFrame.data[channelIndex].data;
          channelName[operandName] = operand.channelName;
        }
        else {
          let channelIndex = indexOfChannel(subtractionOrder, operand, dataId);
          channelData[operandName] = dataFrame.data[channelIndex].data;
          channelName[operandName] = allChannelInfo[channelIndex].name;
        }
      });
      let subtractionName = '';
      if (has.plus) {
        subtractionName += channelName.plus;
      }
      if (has.minus) {
        subtractionName += '-' + channelName.minus;
      }
      if (has.plus) {
        if (has.minus) {
          if (channelData.plus === channelData.minus) {
            subtractionData = new FloatArrayType(dataFrame.numSamples);
            subtractionData.fill(0);
          }
          else {
            subtractionData = channelData.plus.map((value, v) => { return value - channelData.minus[v]; });
          }
        }
        else {
          subtractionData = channelData.plus;
        }
      }
      else {
        if (has.minus) {
          subtractionData = channelData.minus.map((value, v) => { return -value; });
        }
        else {
          subtractionData = new FloatArrayType(dataFrame.numSamples);
          subtractionData.fill(0);
        }
      }
      allChannelInfo.push({ name: subtractionName, dataId: dataId });
      subtractionOrder.push({ name: subtraction.key, dataId: dataId });
      dataFrame.data.push({ data: subtractionData, dataId: dataId });
    });
    // console.timeEnd('computeSubtractions');
    let channelInfoOrdered = [];
    let dataOrdered = [];
    channelsDisplayedParsed.subtractions.forEach((subtraction) => {
      const subtractionIndex = indexOfChannel(subtractionOrder, subtraction.key, subtraction.dataId);
      const channelInfo = dataFrame.channelInfo[subtractionIndex];
      const channelData = dataFrame.data[subtractionIndex].data;
      channelInfoOrdered.push(channelInfo);
      dataOrdered.push(channelData);
    });
    dataFrame.channelInfo = channelInfoOrdered;
    dataFrame.data = dataOrdered;
    // console.timeEnd('get.edf.data');
    let dataDict = {};
    dataFrame.channelInfo.forEach((info, c) => {
      if (!dataDict[info.dataId]) dataDict[info.dataId] = {};
      dataDict[info.dataId][info.name] = dataFrame.data[c];
    });

    return {
      channel_order: dataFrame.channelInfo,
      sampling_rate: dataFrame.samplingRate,
      channel_values: dataDict,
    }
  },
  'setup.edf.downsampled' (allRecordings, metadata) {
    let targetDownsamplingRate = '2';
    allRecordings.forEach((recording) => {
      let recordingName = recording.path;
      let recordingMetadata = metadata[recording._id];
      WFDB.downsamp({
        recordingName,
        recordingMetadata,
        targetDownsamplingRate
      });
    });
  }
});