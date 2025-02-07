import { PreferencesFiles, Preferences, Data, Tasks, Assignments, Patients, AnnotationFiles, AlignmentFiles, Annotations} from '/collections';
import moment from 'moment';
import { MaterializeModal } from '/client/Modals/modal.js'
import { EDFFile } from '/collections';

import { Tabular } from "meteor/aldeed:tabular";
import { $ } from 'meteor/jquery';
import dataTablesBootstrap from 'datatables.net-bs';
import 'datatables.net-bs/css/dataTables.bootstrap.css';
import { connections } from 'mongoose';


// double dictionary for task inference
let taskDictionary = {};
let dataDictionary = {};
let page = 1;
let limit = 10;
let cond = {}
var selectedDataG = new ReactiveVar({});
var selectedAssigneesG = new ReactiveVar({});
var selectedTaskG = new ReactiveVar(false);
var loading = new ReactiveVar(false);
var selectedPreferencesG = new ReactiveVar(null);

let renderDate = (dateValue) => {
  if (dateValue instanceof Date) {
    return moment(dateValue).format('YYYY-MM-DD hh:mm');
  } else {
    return 'Never';
  }
}

let getSignalNameSet = (fileMetadata) => {
  let set = new Set();
  fileMetadata.Groups.forEach(element => {
    Object.keys(element.SignalsByName).forEach(element => {
      set.add(element);
    })
  });
  return set;
}

let assembleTaskObj = (signalNameSet, source, file) => {
  if (source === "Other") {
    // Create a task displaying all channels.
    let taskDocument = {
      name: "edf annotation from template: " + file,
      allowedDataTypes: ["EDF"],
      annotator: "EDF",
      annotatorConfig: {
        defaultMontage: source,
        channelsDisplayed: {
          "Other": {
            "Other": Array.from(signalNameSet).map(element => {
              return "'" + element + "'";
            })
          }
        },
        channelGains: {
          "Other": new Array(signalNameSet.size).fill(1)
        },
        staticFrequencyFiltersByDataModality: {
          "'F4-A1'": { highpass: 0.3, lowpass: 35 },
          "'C4-A1'": { highpass: 0.3, lowpass: 35 },
          "'O2-A1'": { highpass: 0.3, lowpass: 35 },
          "'Chin1-Chin2'": { highpass: 10, lowpass: 100 },
          "'LOC-O2'": { highpass: 0.3, lowpass: 35 },
          "'ECG'": { highpass: 0.3, lowpass: 70 },
          "'Leg/L'": { highpass: 10, lowpass: 100 },
          "'Leg/R'": { highpass: 10, lowpass: 100 },
          "'Snore'": { highpass: 10, lowpass: 100 },
          "'Airflow'": { highpass: 0.01, lowpass: 15 },
          "Nasal Pressure": { highpass: 0.01, lowpass: 15 },
          "'Thor'": { highpass: 0.01, lowpass: 15 },
          "'Abdo'": { highpass: 0.01, lowpass: 15 },

          "'EEG'": { highpass: 0.3, lowpass: 35 },
          "'EOG'": { highpass: 0.3, lowpass: 35 },
          "'EMG'": { highpass: 10, lowpass: 100 },
          "'RESP'": { highpass: 0.01, lowpass: 15 },

          "'A1'": { highpass: 0.3, lowpass: 35 },
          "'A2'": { highpass: 0.3, lowpass: 35 },

          "'ROC'": { highpass: 0.3, lowpass: 35 },

          "'Chin 2'": { highpass: 10, lowpass: 100 },

          "'eeg-ch1 - eeg-ch2'": { highpass: 0.3, lowpass: 35 },
          "'eeg-ch4 - eeg-ch2'": { highpass: 0.3, lowpass: 35 },
          "'eeg-ch1'": { highpass: 0.3, lowpass: 35 },
          "'eeg-ch4'": { highpass: 0.3, lowpass: 35 },
          "'eeg-ch1-eeg-ch4'": { highpass: 0.3, lowpass: 35 },
          "'eeg-ch4-eeg-ch3'": { highpass: 0.3, lowpass: 35 },
          "'eeg-ch2'": { highpass: 0.3, lowpass: 35 },
          "'eeg-ch3'": { highpass: 0.3, lowpass: 35 },
          "'eeg-ch2'": { highpass: 0.3, lowpass: 35 },
          "'eeg-ch3'": { highpass: 0.3, lowpass: 35 },
          "'ppg-ch2'": { highpass: 0.1, lowpass: 5 },
          "'Temp'": { highpass: 10, lowpass: 100 },
          "'light'": { highpass: 10, lowpass: 100 },
          "'ENMO'": { highpass: 10, lowpass: 100 },
          "'z - angle'": { highpass: 10, lowpass: 100 },
        }, //
        frequencyFilters: [
          {
            title: "Notch",
            type: "notch",
            options: [
              {
                name: "60 Hz",
                value: 60,
              },
              {
                name: "50 Hz",
                value: 50,
              },
              {
                name: "off",
                value: undefined,
                default: true,
              },
            ],
          },
        ],
        targetSamplingRate: 32,
        useHighPrecisionSampling: false,
        startTime: 0,
        windowSizeInSeconds: 30,
        preloadEntireRecording: false,
        showReferenceLines: false,
        showSleepStageButtons: false,
        showChannelGainAdjustmentButtons: false,
        showBackToLastActiveWindowButton: false,
        showInputPanelContainer: false,
        showBookmarkCurrentPageButton: false,
        showFastForwardButton: true,
        showFastBackwardButton: true,
        graph: {
          height: 530,
          enableMouseTracking: true,
        },
        features: {
          order: ["sleep_spindle", "k_complex", "rem", "vertex_wave"],
          options: {},
        },
      },
    }
    return taskDocument;

  }
}

let deleteFile = (fileName) => {
  return new Promise((resolve, reject) => {
    let patient = Patients.findOne({id:"Unspecified Patient - "+ fileName });
    if (patient) {
      let patient_id = patient["_id"];
      Patients.remove({_id:patient_id});
    }

    Meteor.call('removeFile',fileName,function(err,res){
      if (err){
        console.log(err);
        reject();
        return;
      }
      let selectedData = selectedDataG.get();
      delete selectedData[res];
      selectedDataG.set(selectedData);
      resolve();
    });
  });
};

Template.Data.onRendered(() => {
  // Destroy existing dialogs to avoid duplicates.
  $(".ui-dialog-content").dialog("destroy");

  $("#assignment-delete-dialog").dialog({
    autoOpen: false,
    buttons: [{
      text: "Close",
      click: () => {
        $("#assignment-delete-dialog").dialog("close");
      }
    }],
    title: "Manage Assignments",
    width: "auto"
  });
});

Template.Data.events({
  'click .btn.local': function () {
    const files = document.getElementById("File");
    const folderFiles = document.getElementById("Folder");

    const allFiles = Array.from(files.files).concat(Array.from(folderFiles.files).filter(fileObj => fileObj.name.split('.')[1].toLowerCase() === "edf"));

    window.alert(`You are uploading ${allFiles.length} file(s), press OK to proceed.\n\nPlease do not close this tab until you are notified that all uploading processes have terminated!`);

    let filesSuccessfullyUploaded = 0;
    let filesUploadFailed = "";
    let uploadsEnded = 0;
    loading.set(true);

    for (let i = 0; i < allFiles.length; i++) {
      const input = allFiles[i].name;
      console.log(input)
      console.log(files);
      const recordingPath = `/uploaded/${input}`;
      let promise = new Promise((resolve, reject) => {
        Meteor.call("get.edf.metadata", recordingPath,
          (error, results) => {
            if (error) {
              throw new Error("Cannot get recording metadata\n" + error);
            }
            return resolve(results);
          }
        );
      });

      promise.then(result => {
        console.log(result);
        var patientId = Patients.insert({
          id: "Unspecified Patient - " + input,
        });
        if(taskId = Tasks.findOne({name: "edf annotation from template: " + input})){
          // Data object creation
          console.log("here");
          console.log(taskId);
          var dataDocument = {
            name: input,
            type: "EDF",
            source: "Other",
            patient: patientId,
            path: recordingPath,
            metadata: { wfdbdesc: result },
            defaultTask: taskId._id,
          }
          var dataId = Data.insert(dataDocument);
          console.log(dataId);
          let signalNameSet = getSignalNameSet(result);
          let signalNameString = [...signalNameSet].join(' ');

          dataDictionary[dataId] = signalNameString;
        } else {
          let signalNameSet = getSignalNameSet(result);
          let signalNameString = [...signalNameSet].join(' ');
          let taskDocument = assembleTaskObj(signalNameSet, "Other", input);
          console.log(taskDocument);
          taskID = Tasks.insert(taskDocument);
          console.log(taskID);

          taskDictionary[signalNameString] = taskID;
          // Data object creation
          var dataDocument = {
            name: input,
            type: "EDF",
            source: "Other",
            patient: patientId,
            path: recordingPath,
            metadata: { wfdbdesc: result },
            defaultTask: taskID,
          };
          var dataId = Data.insert(dataDocument);
          console.log(dataId);
          dataDictionary[dataId] = signalNameString;
        }
        /*
        // Data object creation
        var dataDocument = {
          name: input,
          type: "EDF",
          source: "Other",
          patient: patientId,
          path: recordingPath,
          metadata: { wfdbdesc: result },
        }

        var dataId = Data.insert(dataDocument);
        console.log(dataId);

        let signalNameSet = getSignalNameSet(result);
        let signalNameString = [...signalNameSet].join(' ');

        dataDictionary[dataId] = signalNameString;

        let temp = taskDictionary[signalNameString];
        console.log(signalNameString);

        if (!temp) {
          let taskDocument = assembleTaskObj(signalNameSet, "Other", input, dataId);
          console.log(taskDocument);
          let taskID = Tasks.insert(taskDocument);
          console.log(taskID);

          taskDictionary[signalNameString] = taskID
        }
        */
        filesSuccessfullyUploaded++;
        // filesSuccessfullyUploadedString += 'inpu + "\n";
        uploadsEnded++;

        if (uploadsEnded === allFiles.length) {
          loading.set(false);
          window.alert(`${allFiles.length - filesSuccessfullyUploaded}/${allFiles.length} files failed to upload:\n${filesUploadFailed}\n\n$`);
        }

      })
    }

  },
  'click .btn.download': function () {
    loading.set(true);
    $(Template.instance().find('table')).table2csv();
    loading.set(false);
  },
  'click .btn.batchAlignment': function(){
    const files = document.getElementById("CSVs");
    let allFiles = files.files;
    console.log(allFiles);
    window.alert("Creating Assignments from the CSV file, please wait while loading");
    loading.set(true);

    //need to check here because statements execute after the for loop before the reader occasionally
    if(allFiles.length < 1){
      loading.set(false);
    }
    for(i=0; i < allFiles.length; i++){
      const input = allFiles[i];
      if (input) {
        const reader = new FileReader();
        reader.onload = function (e) {
          const text = e.target.result;
          var rowData = text.split('\n');
          console.log(rowData.length);
          var firstColumnIsNumbers = false;
          var checkFirstColumn = rowData[0].split(',');
          // Python generates the first column with numbers, so if thats the case the first row should have
          // an empty space, then the normal header with File1, File2 ...
          if(checkFirstColumn[0] == "" && checkFirstColumn[1] == "File1"){
            firstColumnIsNumbers = true;
          }
          for(j=1; j<rowData.length-1 ; j++){
            var info = rowData[j].split(',');
            // console.log(j);
            // console.log(rowData.length);
            // console.log(info);

            // When CSV files are generated with Python, the first column has the row index, so we must adjust for this
            // Note the CSV file for batch assignment must follow this order
            if(firstColumnIsNumbers){
              var file1 = info[1];
              var file2 = info[2];
              var assignee = info[3];
              var task = info[4];
              var preference = info[5];
              var alignment = info[6];
              var annotations = info[7];
            } else {
              var file1 = info[0];
              var file2 = info[1];
              var assignee = info[2];
              var task = info[3];
              var preference = info[4];
              var alignment = info[5];
              var annotations = info[6];
            }
            
            // Note for batch assignment only file1 and assignee are mandatory
            if(!file1){
              var row = j+1;
              window.alert("File 1 is not defined in row " + row + ". Please fill that information in and try again.");
              loading.set(false);
              // this is to empty the html file input
              $('input[type="file"]').val(null);
              break;
            } 
            if(!assignee){
              var row = j+1;
              window.alert("Assignee is not defined in row " + row + ". Please fill that information in and try again.");
              loading.set(false);

              $('input[type="file"]').val(null);
              break;
            }
            if(!file2 && alignment && Number(alignment) != 0){
              var row = j+1;
              window.alert("A single file cannot have an alignment. Please update row:  " + row);
              loading.set(false);

              $('input[type="file"]').val(null);
              break;
            }

            //try to find file1
            try{
              var file1Info = Data.findOne({name: file1});
              var file1Id = file1Info._id;
            } catch(err){
              var row = j+1;
              
              window.alert("File 1 in row " + row + " cannot be found in the database. Please ensure the file 1 written appears in the Data Table and is written correctly in the CSV file.");
              loading.set(false);
              $('input[type="file"]').val(null);
              break;
            }

            // try to find file2 if given
            try{
              var file2Info = file2 ? Data.findOne({name: file2}) : null;
              var file2Id = file2 ? file2Info._id : null;
            } catch(err){
              var row = j+1;
              
              window.alert("File 2 in row " + row + " cannot be found in the database. Please ensure the file 2 written appears in the Data Table and is written correctly in the CSV file.");
              loading.set(false);
              $('input[type="file"]').val(null);
              break;
            }

            //try to find the assignee
            try{
              var assigneeId = Meteor.users.findOne({username: assignee})._id;
            } catch(err){
              var row = j+1;
              
              window.alert("Assignee in row " + row + " cannot be found in the database. Please ensure the assignee username is written correctly.");
              loading.set(false);
              $('input[type="file"]').val(null);
              break;
            }

            //try to get the task for file1 (if not then file2)

            // IMPORTANT: there are around 50 files that dont have tasks assigned to them, 
            // so if you run into a problem where the tasks cannot be found, then the solution is to
            // reupload the files in that row to the data tab. (Tasks are auto generated when you upload files
            // to the data tab, but before there was a bug where batch upload wouldnt create all the tasks, so 
            // must reupload)
            try{
              // var file1Info = Data.findOne({name: file1});
              // var file1Id = file1Info._id;
              // var file2Id = file2 ? Data.findOne({name: file2})._id : null;
              // var assigneeId = Meteor.users.findOne({username: assignee})._id;
              var taskId;
              if(!task){
                checkTask1 = Tasks.findOne({name: "edf annotation from template: " + file1Info.name});
                if(checkTask1){
                  taskId = checkTask1._id;
                } else {
                  //if the task for file 1 doesnt exist then check file 2, if that doesnt exist then raise an error
                  taskId = Tasks.findOne({name: "edf annotation from template: " + file2Info.name})._id;
                }
              } else {
                var taskId = Tasks.findOne({name: task})._id;
              }
            } catch(err){
              var row = j+1;
              window.alert("The task information in " + row + " cannot be found. Please reupload file1 and file2 to the data tab so that we can generate the task object");
              loading.set(false);
              $('input[type="file"]').val(null);
              break;
            }

            var dataFiles = file2Id != null ? [file1Id, file2Id] : [file1Id];
            var obj = {
              users: [assigneeId],
              task: taskId,
              dataFiles: dataFiles,
              reviewer: Meteor.userId(),
            }
            //console.log(dataFiles);

            // if the preference file exists get all the required info and check if it matches the given files
            // (to match, the number of channels MUST be the same)
            if(preference){
              var preferenceFile= PreferencesFiles.findOne({name: preference});
              if(preferenceFile){
                var preferenceAnnotatorConfig = preferenceFile.annotatorConfig;
                var f1Channels = Data.findOne({name: file1}).metadata.wfdbdesc.Groups[0].Signals.length;
                var f2Channels = file2 ? Data.findOne({name: file2}).metadata.wfdbdesc.Groups[0].Signals.length : 0;
                var totalChannels = f1Channels + f2Channels;

                console.log(totalChannels);
                var prefChannels = Object.values(preferenceAnnotatorConfig.scalingFactors).length;
                console.log(prefChannels);
                if(prefChannels != totalChannels){
                  var row = j+1;
                  window.alert("The Preferences file in row " + row + " does not match. Please change or remove that file.");
                  loading.set(false);
                  $('input[type="file"]').val(null);
                  break;
                }
              }
            }

            //If the assignment does not exist then insert it, otherwise do nothing
            if(!Assignments.findOne(obj)){
              var assignmentId = Assignments.insert(obj, function(err, docInserted){
                if(err){
                  console.log(err);
                  return;
                }
                console.log(docInserted._id);
                assignmentId = docInserted._id;
  
              });
              // console.log(assignmentId);
            
              // console.log(preference);
              // If the preference file is given then insert that into Preferebces
              if(preference){
                var preferenceFile= PreferencesFiles.findOne({name: preference});
                if(preferenceFile){
                  var preferenceAnnotatorConfig = preferenceFile.annotatorConfig;
                  // To include alignment info it needs to be in the preferences, so if we are given an alignment
                  // include that in the preferences' annotatorConfig
                  if(alignment){
                    // Note: For alignment we accept either the Filename OR just a number
                    if(!isNaN(alignment)){
                      preferenceAnnotatorConfig.channelTimeshift = Number(alignment);
                    } else {
                      var alignmentFile = AlignmentFiles.findOne({filename: alignment});
                      if(alignmentFile){
                        var lag = alignmentFile.lag;
                        preferenceAnnotatorConfig.channelTimeshift = Number(lag);
                      } else{
                        var row = j+1;
                        console.log(alignment);
                        window.alert("The Alignment File in row " + row + " cannot be found. Please ensure that the csv file does not have any errors");
                        loading.set(false);
                        $('input[type="file"]').val(null);
                        break;
                      }
                    }
                  }
                  Preferences.insert({
                    assignment: assignmentId,
                    user: assigneeId,
                    dataFiles: dataFiles,
                    annotatorConfig: preferenceAnnotatorConfig,
                  })
                } else {
                  var row = j+1;
                  window.alert("The Preferences File in row " + row + " cannot be found. Please ensure that the csv file does not have any errors");
                  loading.set(false);
                  $('input[type="file"]').val(null);
                  break;
                }
                
              }
              // if there is no preference file but there is an alignment file, we need to create a standard
              // annotatorConfig (Preferences) to include the alignment
              if(!preference && alignment){
                console.log(alignment);
                // When creating a blank preferences all we really need is the startTime
                var sampleAnnotatorConfig = {
                  startTime: 0
                }
                // Note: For alignment we accept either the Filename OR just a number
                if(!isNaN(alignment)){
                  sampleAnnotatorConfig.channelTimeshift = Number(alignment);
                } else {
                  var alignmentFile = AlignmentFiles.findOne({filename: alignment});
                  if(alignmentFile){
                    var lag = alignmentFile.lag;
                    console.log(lag);
                    sampleAnnotatorConfig.channelTimeshift = Number(lag);
                  } else{
                    var row = j+1;
                    window.alert("The Alignment File in row " + row + " cannot be found. Please ensure that the csv file does not have any errors");
                    loading.set(false);
                    $('input[type="file"]').val(null);
                    break;
                  }
                }
                Preferences.insert({
                  assignment: assignmentId,
                  user: assigneeId,
                  dataFiles: dataFiles,
                  annotatorConfig: sampleAnnotatorConfig,
                })
              }

              // console.log(1);
              // If we are given an annotation file then we create a new Annotation object for each annotation
              if(annotations){
                // console.log(2);
                var annotationFile = AnnotationFiles.findOne({filename: annotations});
                console.log(annotationFile);
                if(annotationFile){
                  var allAnnotations = annotationFile.annotations;
                  var docs = [];
                  Object.values(allAnnotations).forEach(info => {
                    var value = {};
                    // To ensure we arent reading the last line of the csv file which would just be { index: '' }
                    if(info.channels){
                      if(info.channels == "All"){
                        // We need to know the number of channels in the assignment so that we can make the box the correct size
                        var f1Channels = Data.findOne({name: file1}).metadata.wfdbdesc.Groups[0].Signals.length;
                        var f2Channels = file2 ? Data.findOne({name: file2}).metadata.wfdbdesc.Groups[0].Signals.length : 0;
  
                        var totalChannels = f1Channels + f2Channels;
                        var channels = []
                        for(k=0; k < totalChannels; k++){
                          channels.push(k);
                        }
                      } else {
                        //TODO: We do not add annotations other than box for now, given that the others are not common.
                        console.log(info);
                        
                        window.alert("Skipping Annotation, as it does not match the file (Not for all channels)")
                      }
                      // console.log(channels);
                      // Get all the required information ready
                      var position = {
                        channels: channels,
                        start: Number(info.time),
                        end: Number(info.time) + Number(info.duration)
                      };
                      var metadata = {
                        annotationLabel: info.annotation,
                      }
                      value.position = position;
                      value.metadata = metadata;
                      var obj = {
                        assignment: assignmentId,
                        user: assigneeId,
                        dataFiles: dataFiles,
                        // placeholder for now (other annotations are also signal_annotation?)
                        type: info.type == "Event" ? "SIGNAL_ANNOTATION" : "SIGNAL_ANNOTATION",
                        value: value
                      }
                      // console.log(obj);
                      Annotations.insert(obj);
                      //docs.push(obj);
                    }
                    
                  });
                } else {
                  var row = j+1;
                  window.alert("The Annotations File in row " + row + " cannot be found. Please ensure that the csv file does not have any errors");
                  loading.set(false);
                  $('input[type="file"]').val(null);
                  break;
                }
              }
            }          
            

          }
          // We cant have loading after the reader.readAsText(..) as that statement is executed before the for loop starts
          console.log("done");
          loading.set(false);
          //alert("Assignments Created");
          $('input[type="file"]').val(null);
          

        };
        reader.readAsText(input);
      } else {
        //Note: For the data page if you want to include the loading spinner just do the loading.set(true) 
        // to turn it on and below to turn it off.
        loading.set(false);
      }
    }
  },
  'click .btn.upload': function () {
    const files = document.getElementById("File");
    const folderFiles = document.getElementById("Folder");

    let allFilesUnfiltered = Array.from(files.files).concat(Array.from(folderFiles.files).filter(fileObj => fileObj.name.split('.').at(-1).toLowerCase() === "edf"));
    const allFiles = allFilesUnfiltered.filter((file, i) => {
      return allFilesUnfiltered.findIndex((e) => {
        return e.name === file.name;
      }) === i;
    });

    console.log(allFiles);

    window.alert(`You are uploading ${allFiles.length} file(s), press OK to proceed.\n\nPlease do not close this tab until you are notified that all uploading processes have terminated!`);

    let filesSuccessfullyUploaded = 0;
    let filesUploadFailed = "";
    let uploadsEnded = 0;
    let filesSuccessfullyUploadedString = "";
    let overwritePromise = false;
    let overwriteDuplicates = false;

    loading.set(true);
    //need to check here because statements execute after the for loop before the reader occasionally
    if(allFiles.length < 1){
      loading.set(false);
    }

    for (let i = 0; i < allFiles.length; i++) {

      const input = allFiles[i];


      if (input) {
        const reader = new FileReader();

        reader.onload = function (e) {

          console.log("initiating file upload");
          console.log(EDFFile);

          // Since EDFFile is a promise, we need to handle it as such
          EDFFile.then(result => {
            let checkIfFileExists = new Promise((resolve, reject) => {
              Meteor.call("get.file.exists", input.name,
                (error, result) => {
                  if (error) {
                    throw new Error("Error checking file\n" + error);
                  }

                  if (result) {
                    if (!overwritePromise) {
                      overwritePromise = new Promise((oResolve, oReject) => {
                        const modalTransitionTimeInMilliSeconds = 300;
                        MaterializeModal.confirm({
                          title: 'Duplicate File',
                          message: 'Duplicate Files Detected. Overwrite?<br>',
                          submitLabel: '<i class="fa fa-check left"></i> Overwrite All Duplicates',
                          closeLabel: '<i class="fa fa-times left"></i> Ignore Duplicates',
                          outDuration: modalTransitionTimeInMilliSeconds,
                          callback(error, response) {
                            if (error) {
                              alert(error);
                              oReject(error);
                              reject(error);
                              return;
                            }
                            if (!response.submit) {
                              oResolve();
                              return;
                            }

                            overwriteDuplicates = true;
                            oResolve();
                          }
                        });
                      });
                    }

                    overwritePromise.then(() => {
                      if (overwriteDuplicates) {
                        deleteFile(input.name).then(() => {
                          resolve();
                        }).catch((err) => {
                          console.log(err);
                          reject(err);
                        });
                      } else {
                        reject("Duplicate file skipped.");
                        return;
                      }
                    });
                  } else {
                    resolve();
                  }
                }
              );
            });

            checkIfFileExists.then(() => {
              var uploadInstance = result.insert({
                file: input,
                chunkSize: 'dynamic',
                fileName: input.name
              }, false);
  
              uploadInstance.on('end', function (error, fileObj) {
                if (error) {
                  loading.set(false);
                  window.alert(`Error uploading ${fileObj.name}: ` + error);
                  filesUploadFailed += fileObj.name + ": " + error + "\n";
                  uploadsEnded++;
                  if (uploadsEnded === allFiles.length) {
                    loading.set(false);
                    window.alert(`${allFiles.length - filesSuccessfullyUploaded}/${allFiles.length} files failed to upload:\n${filesUploadFailed}\n\n${filesSuccessfullyUploaded}/${allFiles.length} files successfully uploaded:\n${filesSuccessfullyUploadedString}`);
                  }
                } else {
                  // window.alert('File "' + fileObj.name + '" successfully uploaded');
  
                  const recordingPath = `/uploaded/${uploadInstance.config.fileId}.edf`;
  
                  let promise = new Promise((resolve, reject) => {
                    Meteor.call("get.edf.metadata", recordingPath,
                      (error, results) => {
                        if (error) {
                          throw new Error("Cannot get recording metadata\n" + error);
                        }
  
                        return resolve(results);
                      }
                    );
                  });
  
                  promise.then(result => {
                    console.log(result);
                    var patientId = Patients.insert({
                      id: "Unspecified Patient - " + fileObj.name,
                    });

                    if(taskId = Tasks.findOne({name: "edf annotation from template: " + fileObj.name})){
                      // Data object creation
                      console.log("here");
                      console.log(taskId);
                      var dataDocument = {
                        name: fileObj.name,
                        type: "EDF",
                        source: "Other",
                        patient: patientId,
                        path: recordingPath,
                        metadata: { wfdbdesc: result },
                        defaultTask: taskId._id,
                      }
                      var dataId = Data.insert(dataDocument);
                      console.log(dataId);
                      let signalNameSet = getSignalNameSet(result);
                      let signalNameString = [...signalNameSet].join(' ');
  
                      dataDictionary[dataId] = signalNameString;
                    } else {
                      let signalNameSet = getSignalNameSet(result);
                      let signalNameString = [...signalNameSet].join(' ');
                      let taskDocument = assembleTaskObj(signalNameSet, "Other", fileObj.name);
                      console.log(taskDocument);
                      taskID = Tasks.insert(taskDocument);
                      console.log(taskID);
  
                      taskDictionary[signalNameString] = taskID;
                      // Data object creation
                      var dataDocument = {
                        name: fileObj.name,
                        type: "EDF",
                        source: "Other",
                        patient: patientId,
                        path: recordingPath,
                        metadata: { wfdbdesc: result },
                        defaultTask: taskID,
                      };
                      var dataId = Data.insert(dataDocument);
                      console.log(dataId);
                      dataDictionary[dataId] = signalNameString;
                    }
                    /*
                    // Data object creation
                    var dataDocument = {
                      name: fileObj.name,
                      type: "EDF",
                      source: "Other",
                      patient: patientId,
                      path: recordingPath,
                      metadata: { wfdbdesc: result },
                    }
  
                    var dataId = Data.insert(dataDocument);
                    console.log(dataId);
  
                    let signalNameSet = getSignalNameSet(result);
                    let signalNameString = [...signalNameSet].join(' ');
  
                    dataDictionary[dataId] = signalNameString;
  
                    let temp = taskDictionary[signalNameString];
                    console.log(signalNameString);
                    console.log(taskDictionary);
  
                    if (!temp) {
                      if(taskId = Tasks.findOne({name: "edf annotation from template: " + fileObj.name})){
                        taskDictionary[signalNameString] = taskId;
                      } else {
                        let taskDocument = assembleTaskObj(signalNameSet, "Other", fileObj.name, dataId);
                        console.log(taskDocument);
                        taskID = Tasks.insert(taskDocument);
                        console.log(taskID);
    
                        taskDictionary[signalNameString] = taskID;
                      }
                    }
                    */
                    filesSuccessfullyUploaded++;
                    filesSuccessfullyUploadedString += fileObj.name + "\n";
                    uploadsEnded++;
  
                    if (uploadsEnded === allFiles.length) {
                      loading.set(false);
                      window.alert(`${allFiles.length - filesSuccessfullyUploaded}/${allFiles.length} files failed to upload:\n${filesUploadFailed}\n\n${filesSuccessfullyUploaded}/${allFiles.length} files successfully uploaded:\n${filesSuccessfullyUploadedString}`);
                    }
  
                  })
  
  
                }
  
  
              });
  
              uploadInstance.start();
            }, (err) => {
              uploadsEnded++;
              filesUploadFailed += input.name + ": " + err + "\n";
  
              if (uploadsEnded === allFiles.length) {
                loading.set(false);
                window.alert(`${allFiles.length - filesSuccessfullyUploaded}/${allFiles.length} files failed to upload:\n${filesUploadFailed}\n\n${filesSuccessfullyUploaded}/${allFiles.length} files successfully uploaded:\n${filesSuccessfullyUploadedString}`);
              }
            });
          }).catch(error => {
            loading.set(false);
            console.log("Upload Process Failed: ", error);
          });


        };
        reader.readAsText(input);
      }
    }



  },
  'autocompleteselect input.task'(event, template, task) {
    console.log(task);
    template.selectedTask.set(task);
  },
  'autocompleteselect input.task'(event, template, task) {
    console.log(task);
    template.selectedTask.set(task);
  },
  'autocompleteselect input.preferences'(event, template, preferences) {
    console.log(preferences);
    template.selectedPreferences.set(preferences);
  },
  'click .change-page'(event, template) {
    template.change.set(false)
    console.log(document.getElementById('page'))
    page = parseInt(document.getElementById('page').value);
    console.log(document);
    limit = parseInt(document.getElementById('limit').value);
    cond = {};
    let patientId = document.getElementById('patientId') ? document.getElementById('patientId').value : null;
    let path = document.getElementById('path') ? document.getElementById('path').value : null;
    //console.log(path);
    if (patientId) cond["name"] = patientId;
    if (path) cond["path"] = path;
    //console.log(cond);
    console.log(template);
    Meteor.setTimeout(() => (template.change.set(true)), 1000);
  },
  'autocompleteselect input.assignee'(event, template, user) {
    const selectedAssignees = template.selectedAssignees.get();
    selectedAssignees[user._id] = user;
    template.selectedAssignees.set(selectedAssignees);
  },
  'click .assignees .delete'(event, template) {
    console.log(template.selectedAssignees.get());
    const dataId = $(event.currentTarget).data('id');
    const selectedAssignees = template.selectedAssignees.get();
    delete selectedAssignees[dataId];
    template.selectedAssignees.set(selectedAssignees);
  },
  'click .btn.assign'(event, template) {
    if (document.getElementById("alginment") && document.getElementById("alginment").checked === true) {
      const modalTransitionTimeInMilliSeconds = 300;
      MaterializeModal.form({
        title: '',
        bodyTemplate: 'assignSettingsForm',
        submitLabel: '<i class="fa fa-check left"></i> Preview Alignment',
        closeLabel: '<i class="fa fa-times left"></i> Cancel',
        outDuration: modalTransitionTimeInMilliSeconds,
        callback(error, response) {
          if (error) {
            alert(error);
            return;
          }
          if (!response.submit) return;

          const task = template.selectedTask.get();
          const data = Object.values(template.selectedData.get());
          const assigneesDict = template.selectedAssignees.get();
          const assignees = Object.values(template.selectedAssignees.get());
          console.log(assignees);
          console.log(data);

          const assignmentsByAssignee = {};
          assignees.forEach((assignee) => {
            const assignmentsForAssignee = []
            data.forEach((d) => {
              let doAssign = true;
              assignmentsForAssignee.push({
                doAssign: doAssign,
                data: d,
              });
            });
            assignmentsByAssignee[assignee._id] = assignmentsForAssignee;
            console.log(assignmentsByAssignee);
          });

          let assignmentsFormatted = '';
          Object.keys(assignmentsByAssignee).forEach((assigneeId) => {
            const assignee = assigneesDict[assigneeId];
            const assignments = assignmentsByAssignee[assigneeId];
            activeAssignments = assignments.filter(a => a.doAssign);
            assignmentsFormatted += '<b>' + assignee.username + '</b> (' + activeAssignments.length + '):<br><br><ul>';
            assignments.forEach((assignment) => {
              const dataPath = assignment.data.pathAndLengthFormatted();
              if (assignment.doAssign) {
                assignmentsFormatted += '<li><b>' + dataPath + '</b></li>';
              }
              else {
                assignmentsFormatted += '<li><strike>' + dataPath + '</strike></li>';
              }
            });
            assignmentsFormatted += '</ul>';
          });

          window.setTimeout(function () {
            MaterializeModal.confirm({
              title: 'Confirm assignments',
              message: 'Your selection resulted in the following list of assignments:<br><br>' + assignmentsFormatted,
              submitLabel: '<i class="fa fa-check left"></i> Create Alignment',
              closeLabel: '<i class="fa fa-times left"></i> Cancel',
              outDuration: modalTransitionTimeInMilliSeconds,
              callback(error, response) {
                if (error) {
                  alert(error);
                  return;
                }
                if (!response.submit) {
                  return;
                }
                var matchingFiles = true;
                const preferencesAnnotatorConfig = template.selectedPreferences.get() ? template.selectedPreferences.get().annotatorConfig : null;
                Object.keys(assignmentsByAssignee).forEach((assigneeId) => {
                  const assignments = assignmentsByAssignee[assigneeId];
                  var dataFiles = assignments.map((assignment) =>
                    assignment.data._id
                  );
                  if(preferencesAnnotatorConfig && matchingFiles){
                    // alignment has strictly 2 files
                    var numChannels1 = assignments[0].data.metadata.wfdbdesc.Groups[0].Signals.length;
                    var numChannels2 = assignments[1].data.metadata.wfdbdesc.Groups[0].Signals.length;
                    //console.log(numChannels);
                    var totalChannels = numChannels1 + numChannels2;
                    if(totalChannels != Object.keys(preferencesAnnotatorConfig.scalingFactors).length){
                      window.alert("Preferenes file does not match the files for this assignment. Please upload a different preferences file.");
                      matchingFiles = false;
                      return;
                    }
                  }

                  var obj = {
                    users: [assigneeId],
                    task: task._id,
                    dataFiles: dataFiles,
                    reviewer: Meteor.userId(),
                  }
                  var assignmentId = Assignments.insert(obj, function(err, docInserted){
                    if(err){
                      console.log(err);
                      console.log("error boy")
                      return;
                    }
                    console.log(docInserted._id);
                    assignmentId = docInserted._id;

                  });
                  console.log(assignmentId);
                  

                  if(preferencesAnnotatorConfig){
                    Preferences.insert({
                      assignment: assignmentId,
                      user: assigneeId,
                      dataFiles: dataFiles,
                      annotatorConfig: preferencesAnnotatorConfig,
                    })
                  }

                });


                template.selectedTask.set(false);
                template.selectedData.set({});
                template.selectedAssignees.set({});
                template.selectedPreferences.set(null);

                if(matchingFiles){
                  window.setTimeout(function () {
                    MaterializeModal.message({
                      title: 'Done!',
                      message: 'Your selected alignment have been created successfully.',
                      outDuration: modalTransitionTimeInMilliSeconds,
                    });
                  }, modalTransitionTimeInMilliSeconds);
                }
                
              },
            });
          }, modalTransitionTimeInMilliSeconds);
        },
      })
    } else {
      const modalTransitionTimeInMilliSeconds = 300;
      MaterializeModal.form({
        title: '',
        bodyTemplate: 'assignSettingsForm',
        submitLabel: '<i class="fa fa-check left"></i> Preview Assignments',
        closeLabel: '<i class="fa fa-times left"></i> Cancel',
        outDuration: modalTransitionTimeInMilliSeconds,
        callback(error, response) {
          if (error) {
            alert(error);
            return;
          }
          if (!response.submit) return;
          const r = response.value;

          const task = template.selectedTask.get();
          const data = Object.values(template.selectedData.get());
          const assigneesDict = template.selectedAssignees.get();
          const assignees = Object.values(template.selectedAssignees.get());

          const assignmentsByAssignee = {};
          assignees.forEach((assignee) => {
            const assignmentsForAssignee = []
            data.forEach((d) => {
              let doAssign = true;
              if (r.avoidDuplicateAssignmentsForIndividualReaders) {
                const duplicateAssignment = Assignments.findOne({
                  task: task._id,
                  users: assignee._id,
                  dataFiles: [d._id],
                });
                if (duplicateAssignment) {
                  doAssign = false;
                }
              }
              assignmentsForAssignee.push({
                doAssign: doAssign,
                data: d,
              });
            });
            assignmentsByAssignee[assignee._id] = assignmentsForAssignee;
          });

          let assignmentsFormatted = '';
          Object.keys(assignmentsByAssignee).forEach((assigneeId) => {
            const assignee = assigneesDict[assigneeId];
            const assignments = assignmentsByAssignee[assigneeId];
            activeAssignments = assignments.filter(a => a.doAssign);
            assignmentsFormatted += '<b>' + assignee.username + '</b> (' + activeAssignments.length + '):<br><br><ul>';
            assignments.forEach((assignment) => {
              const dataPath = assignment.data.pathAndLengthFormatted();
              if (assignment.doAssign) {
                assignmentsFormatted += '<li><b>' + dataPath + '</b></li>';
              }
              else {
                assignmentsFormatted += '<li><strike>' + dataPath + '</strike></li>';
              }
            });
            assignmentsFormatted += '</ul>';
          });

          window.setTimeout(function () {
            MaterializeModal.confirm({
              title: 'Confirm assignments',
              message: 'Your selection resulted in the following list of assignments:<br><br>' + assignmentsFormatted,
              submitLabel: '<i class="fa fa-check left"></i> Create Assignment(s)',
              closeLabel: '<i class="fa fa-times left"></i> Cancel',
              outDuration: modalTransitionTimeInMilliSeconds,
              callback(error, response) {
                if (error) {
                  alert(error);
                  return;
                }
                if (!response.submit) {
                  return;
                }

                var matchingFiles = true;
                const preferencesAnnotatorConfig = template.selectedPreferences.get() ? template.selectedPreferences.get().annotatorConfig : null;
                Object.keys(assignmentsByAssignee).forEach((assigneeId) => {
                  const assignee = assigneesDict[assigneeId];
                  const assignments = assignmentsByAssignee[assigneeId];
                  assignments.forEach((assignment) => {
                    if (!assignment.doAssign) return;

                    if(preferencesAnnotatorConfig && matchingFiles){
                      var numChannels = assignment.data.metadata.wfdbdesc.Groups[0].Signals.length;
                      console.log(numChannels);
                      if(numChannels != Object.keys(preferencesAnnotatorConfig.scalingFactors).length){
                        window.alert("Preferenes file does not match the file for this assignment. Please upload a different preferences file.");
                        matchingFiles = false;
                        return;
                      }
                    }
                    
                    // Given that only admins can access the Data tab we can just assign reviewer to the current admin user                    
                    var obj = {
                      users: [assigneeId],
                      task: task._id,
                      dataFiles: [assignment.data._id],
                      reviewer: Meteor.userId(),
                    }
                    var assignmentId = Assignments.insert(obj, function(err, docInserted){
                      if(err){
                        console.log(err);
                        console.log("error boy")
                        return;
                      }
                      console.log(docInserted._id);
                      assignmentId = docInserted._id;

                    });
                    console.log(assignmentId);
                    

                    if(preferencesAnnotatorConfig){
                      Preferences.insert({
                        assignment: assignmentId,
                        user: assigneeId,
                        dataFiles: [assignment.data._id],
                        annotatorConfig: preferencesAnnotatorConfig,
                      })
                    }
                    
                  });
                });

                template.selectedTask.set(false);
                template.selectedData.set({});
                template.selectedAssignees.set({});
                template.selectedPreferences.set(null);

                if(matchingFiles){
                  window.setTimeout(function () {
                    MaterializeModal.message({
                      title: 'Done!',
                      message: 'Your selected assignments have been created successfully.',
                      outDuration: modalTransitionTimeInMilliSeconds,
                    });
                  }, modalTransitionTimeInMilliSeconds);
                }
                
              },
            });
          }, modalTransitionTimeInMilliSeconds);
        },
      });
    }
  },
});



Template.Data.helpers({
  settings() {
    const selectedData = Template.instance().selectedData;
    console.log("start");
    console.log(Data);
    const data = Data.find(cond, { skip: (page - 1) * limit, limit:limit}).fetch();
    console.log(data);
    console.log(page);
    data.forEach((d) => {
      d.lengthFormatted = d.lengthFormatted();
      d.lengthInSeconds = d.lengthInSeconds();
      d.createdAt = renderDate(d.createdAt);
      d.updatedAt = renderDate(d.updatedAt);
      d.numAssignmentsNotCompleted = d.numAssignmentsNotCompleted();
      d.numAssignmentsInProgress = d.numAssignmentsInProgress();
      d.numAssignmentsPending = d.numAssignmentsPending();
      d.numAssignmentsCompleted = d.numAssignmentsCompleted();
      d.numAssignments = d.numAssignments();
      d.assigneeNames = d.assigneeNames();
      const patientDoc = d.patientDoc();
      if (patientDoc) {
        d.patientId = patientDoc.id;
        d.patientAge = patientDoc.age;
        d.patientSex = patientDoc.sex;
      }
    });
    fields = [
      {
        key: 'path',
        label: 'Path',
        sortOrder: 1,
        sortDirection: 'asc',
      },
      {
        key: 'lengthFormatted',
        label: 'Length (formatted)',
      },
      {
        key: 'lengthInSeconds',
        label: 'Length [seconds]',
        hidden: true,
      },
      {
        key: 'patientId',
        label: 'Patient #',
        sortOrder: 0,
        sortDirection: 'asc',
      },
      {
        key: 'patientAge',
        label: 'Age',
      },
      {
        key: 'patientSex',
        label: 'Sex',
      },
      {
        key: 'numAssignments',
        label: '# Assignments',
      },
      {
        key: 'numAssignmentsCompleted',
        label: '# Assignments Completed',
      },
      {
        key: 'numAssignmentsNotCompleted',
        label: '# Assignments Not Completed',
        hidden: true,
      },
      {
        key: 'numAssignmentsInProgress',
        label: '# Assignments In Progress',
        hidden: true,
      },
      {
        key: 'numAssignmentsPending',
        label: '# Assignments Pending',
        hidden: true,
      },
      {
        key: 'assigneeNames',
        label: 'Assignees',
      },
      {
        key: 'capturedAt',
        label: 'Captured',
        sortOrder: 2,
        sortDirection: 'asc',
      },
      {
        key: 'createdAt',
        label: 'Created',
        hidden: true,
      },
      {
        key: 'updatedAt',
        label: 'Last Updated',
        hidden: true,
      },
      //CODE FOR THE DELETE COLUMN IN FILES REACTIVE TABLE
      {
        key: 'DELETE',
        label: 'DELETE',
        fn: (value, object, key) => {
          const inputId = object._id;
          return new Spacebars.SafeString('<button type = "button" class = "btn delete-button" data-id = ' + inputId + ' = >DELETE</button>');
        }
      },
      //END OF CODE FOR THE DELETE COLUMN IN FILES REACTIVE TABLE
      {
        key: 'selectFn',
        label: 'Selected',
        fn: (value, object, key) => {
          const inputId = 'select-data-' + object._id;
          let checkedString = '';
          if (selectedData.get()[object._id]) {
            checkedString = ' checked="checked"';
          }
          return new Spacebars.SafeString('<input type="checkbox"' + checkedString + ' class="select-data" id="' + inputId + '" data-id="' + object._id + '"><label for="' + inputId + '"></label>');
        }
      },
    ];
    return {
      collection: data,
      showColumnToggles: true,
      showRowCount: true,
      rowsPerPage: limit,
      rowClass: function (data) {
        if (selectedData.get()[data._id]) {
          return 'selected-data ';
        }
        else if (data.numAssignmentsCompleted > 0) {
          return 'green lighten-4';
        }
        else if (data.numAssignmentsInProgress > 0) {
          return 'yellow lighten-4';
        }
        else if (data.numAssignmentsPending > 0) {
          return 'blue lighten-4';
        }
        return '';
      },
      filters: [
        'filterDataPath',
        'filterPatientId',
        'filterPatientAge',
        'filterNumAssignments',
      ],
      fields: fields,
    };
  },
  filterFieldsDataPath: ['path'],
  filterFieldsPatientId: ['patientId'],
  filterFieldsPatientAge: ['patientAge'],
  filterFieldsNumAssignments: ['numAssignments'],
  data() {
    return Object.values(Template.instance().selectedData.get());
  },
  loading(){
    //console.log(Template.instance());
    return Template.instance().loading.get();
  },
  preferencesAutoCompleteSettings(){
    console.log(PreferencesFiles.find());
    console.log(Data.find())
    return {
      limit: Number.MAX_SAFE_INTEGER,
      rules: [
        {
          collection: PreferencesFiles,
          field: 'name',
          matchAll: true,
          template: Template.preferencesAutocomplete,
        }
      ]
    }
  },
  preferences(){
    return Template.instance().selectedPreferences.get();
  },
  taskAutocompleteSettings() {
    return {
      limit: Number.MAX_SAFE_INTEGER,
      rules: [
        {
          collection: Tasks,
          field: 'name',
          matchAll: true,
          template: Template.taskAutocomplete
        }
      ]
    }
  },
  task() {
    return Template.instance().selectedTask.get();
  },
  singleUserAutocompleteSettings() {
    return {
      limit: Number.MAX_SAFE_INTEGER,
      rules: [
        {
          collection: Meteor.users,
          field: 'username',
          matchAll: true,
          template: Template.userAutocomplete,
        }
      ]
    }
  },
  assignees() {
    console.log(Template.instance().selectedAssignees.get());
    return Object.values(Template.instance().selectedAssignees.get());
  },
  changePage() {
    return Template.instance().change.get();
  },
  align() {
    console.log(Object.values(Template.instance().selectedData.get()).length === 2)
    return Object.values(Template.instance().selectedData.get()).length === 2;
  },
  getPage() {
    return page;
  },
  getLimit() {
    return limit;
  },
  getPatientID: function(){
    console.log(this);
    return "unspecified";
  }
});

Template.Data.events({
  'change .data .reactive-table tbody input[type="checkbox"].select-data': function (event, template) {
    const target = $(event.target);
    const isSelected = target.is(':checked');
    const dataId = target.data('id');
    const selectedData = template.selectedData.get();
    console.log(selectedData);
    console.log(template)
    if (isSelected) {
      const data = Data.findOne(dataId);
      selectedData[dataId] = data;

      let signalNameString = dataDictionary[dataId];
      // console.log(signalNameString);
      // console.log(dataDictionary);
      // console.log(dataId);
      if (signalNameString) {
        let taskId = taskDictionary[signalNameString];
        console.log(taskId);
        console.log(taskDictionary);
        if (taskId) {
          const task = Tasks.findOne(taskId);
          // console.log(task);
          template.selectedTask.set(task);
        }
      }
      let user = Meteor.user();

      console.log(user);

      let selectedAssignees = template.selectedAssignees.get();
      selectedAssignees[user._id] = user;
      template.selectedAssignees.set(selectedAssignees);

    }
    else {
      delete selectedData[dataId];
    }
    template.selectedData.set(selectedData);
  },
  /*
    'click .delete-button':function(event,template){
    const target = $(event.target);
    const dataId = target.data('id');
    const alldata = Data.findOne({_id:dataId},{fields:{name:1}});

    const file_name = alldata["name"];

    deleteFile(file_name);
  }
  */
  
  
});

// Note here we have the new Table
// Given that we need different templates to render the delete and select button, we have 
// new template events for deleting and selecting.
// Thus all new changes must appear in these events for the new table
// Note that the TabularTables.Data code needs to be in both server and client (idk why either)

TabularTables = {};
Meteor.isClient && Template.registerHelper('TabularTables',TabularTables);

  TabularTables.Data = new Tabular.Table({
    name: "Data",
    collection: Data,
    columns: [
      {data: "name", title: "Name",
        render:function(val, type, row) {
          if (type === 'display') {
            const data = Data.find({_id: row._id}).fetch();
            let path = "";
            data.forEach((d) => {
              path = d.path;
            });
            let pathEnd = path != null ? path.lastIndexOf("/") : -1;
            return pathEnd === -1 ? val : path.substring(0, pathEnd + 1) + val;
          } else {
            return val;
          }
        }},
      {data: "metadata.wfdbdesc.Length", title: "Length",
        render:function(val){
          return val.split(" ")[0];
        }},
      {data: "_id", title: "Patient #", searchable: false,
        render:function(val){
          const data = Data.find({_id: val}).fetch();
          let patientNum = "";
          //Note there will only be one element for forEach is not a big deal
          data.forEach((d)=> {
            patientNum = d.patientDoc().id;
          })
          return patientNum;
        }},
      {data: "_id", title: "# Assignments", searchable: false, 
        render:function(val){
          if(val){
            const data = Data.find({_id: val}).fetch();
            let numAssignments = 0;
            data.forEach((d) => {
              numAssignments = d.numAssignments()
            })
            return numAssignments;
          }
        }},
        {data: "_id", title: "# Assignments Completed", searchable: false, 
        render:function(val){
          const data = Data.find({_id: val}).fetch();
          let numAssignmentsCompleted = 0;
          data.forEach((d) => {fetch
            numAssignmentsCompleted = d.numAssignmentsCompleted()
          })
          return numAssignmentsCompleted;
        }},
        {data: "_id", title: "Assignees", searchable: false, 
        render:function(val){
          const data = Data.find({_id: val}).fetch();
          let assignees = [];
          data.forEach((d) => {
            assignees = d.assigneeNames()
          })
          return assignees;
        }},
      {title: "Manage Assignments",
        tmpl: Meteor.isClient && Template.manageButton},
      {title: "Delete",
        tmpl: Meteor.isClient && Template.deleteButton},
      {title: "Selected", 
        tmpl: Meteor.isClient && Template.selected}
    ],
    initComplete: function() {
      $('.dataTables_empty').html('processing');
    },
    processing: false,
    skipCount: true,
    pagingType: 'simple',
    infoCallback: (settings, start, end, total) => `Total: ${total}, Showing ${start} to ${end} `,
});

Template.selected.helpers({
  id(){
    return this._id;
  },
  isChecked() {
    let selectedData = selectedDataG.get();
    return selectedData[this._id] != null;
  }
});

Template.selected.events({
  'change .select-data': function (event, template) {
    const target = $(event.target);
    const isSelected = target.is(':checked');
    //const dataId = target.data('id');
    const dataId = this._id;
    console.log(this);
    let selectedData = selectedDataG.get();
    //const selectedData = template.selectedData.get();
    //console.log(Template.Data)
    //const selectedData = Template.Data.selectedData.get();
    console.log(Template.Data);
    if (isSelected) {
      const data = Data.findOne(dataId);
      console.log(data);
      selectedData[dataId] = data;
      let taskId = data.defaultTask;
      if (taskId) {
        const task = Tasks.findOne(taskId);
        // console.log(task);
        selectedTaskG.set(task);
      } else if ((Tasks.findOne({name: "edf annotation from template: " + data.name}))){
        const task = Tasks.findOne({name: "edf annotation from template: " + data.name});
        data.defaultTask = task;
        selectedTaskG.set(task);
        console.log(data);
      }

      //let signalNameString = dataDictionary[dataId];
      //console.log(dataDictionary);
      // console.log(signalNameString);
      // console.log(dataDictionary);
      // console.log(dataId);
      /*
      if (signalNameString) {
        let taskId = taskDictionary[signalNameString];
        console.log(taskId);
        console.log(taskDictionary);
        if (taskId) {
          const task = Tasks.findOne(taskId);
          // console.log(task);
          selectedTaskG.set(task);
        }
      }
      */
      let user = Meteor.user();

      console.log(user);

      /*
      let selectedAssignees = template.selectedAssignees.get();
      selectedAssignees[user._id] = user;
      template.selectedAssignees.set(selectedAssignees); 
      */
      let selectedAssignees = selectedAssigneesG.get();
      selectedAssignees[user._id] = user;
      //template.selectedAssignees.set(selectedAssignees);
      selectedAssigneesG.set(selectedAssignees);
      console.log(selectedAssigneesG.get());

    }
    else {
      delete selectedData[dataId];
    }
    selectedDataG.set(selectedData);
  }
});

Template.manageButton.events({
  'click .manage-button': function(event,template){
    const dataId = this._id;

    let assignments = Assignments.find({ dataFiles: dataId }).fetch();
    let tableBody = $(".assignment-delete-table-body");
    tableBody.empty();
    assignments.forEach((assignment) => {
      let task = Tasks.findOne({ _id: assignment.task }).name;
      tableBody.append(`<tr class="assignment-delete-table-row" assignmentId=${assignment._id}>
          <td class="assignment-delete-task">${task}</td>
          <td class="assignment-delete-files">${assignment.dataPath()}</td>
          <td class="assignment-delete-users">${assignment.userNames()}</td>
          <td class="assignment-delete-created">${assignment.createdAt}</td>
          <td class="assignment-delete-delete"><button class="btn assignment-delete-delete-button delete-button">DELETE</button></td>
        </tr>`);
    });

    $(".assignment-delete-delete-button").off("click.assignmentDelete").on("click.assignmentDelete", (e) => {
      let assignmentId = $(e.currentTarget).closest(".assignment-delete-table-row").attr("assignmentId");
      Meteor.call("deleteAssignment", assignmentId, (err, res) => {
        if (err) {
          window.alert(err);
          return;
        }
        $(e.currentTarget).closest(".assignment-delete-table-row").remove();
      });
    });

    $("#assignment-delete-dialog").dialog("open");
  }
});

Template.deleteButton.events({
  'click .delete-button': function(event,template){
    
    //const target = $(event.target);
    //console.log(target);
    console.log(this);
    console.log(this.id);
    //const dataId = target.data('id');
    const dataId = this._id;

    // So that the user knows they cannot delete the original files needed for CROWDEEG to Run
    // I am struggling to make the row for these two blue like the original
    console.log(this);
    if(this.path === "/physionet/edfx/PSG.edf" || this.path === "/physionet/edfx/ANNE.edf"){
      window.alert("You cannot delete " + this.path + " since it is needed for the app to run");
    } else {
      console.log(dataId);
      //const data = Data.findOne(dataId);
      //console.log(data);
      const alldata = Data.findOne({_id:dataId},{fields:{name:1}});
      console.log(alldata);
  
      const file_name = alldata["name"];
      deleteFile(file_name);
      console.log(taskDictionary);


      /*try{
        Data.remove(dataId);
        console.log("Removed from data");
      } catch(error){
        console.log("Not removed from DATA");
        console.log("ERROR: " + error);
      }*/
  

      // This is the old way of deleting before Dawson's fix
      /*
      const patients = Patients.findOne({id:"Unspecified Patient - "+ file_name });
    
      const patient_id = Patients.findOne({id:"Unspecified Patient - "+ file_name })["_id"];
      console.log(patient_id);
      console.log(file_name);
      try{
        Patients.remove({_id:patient_id});
        console.log("Successfully removed from Patients");
      } catch(error){
        console.log("Not removed from Patients");
        console.log("ERROR: " + error);
      }
      
      
  
      try{
        Data.remove(dataId);
        console.log("Removed from data");
      } catch(error){
        console.log("Not removed from DATA");
        console.log("ERROR: " + error);
      }
  
      var file_id = file_name.split(".")[0];
      file_id = file_id.trim();
      console.log(file_id)
    
      Meteor.call('removeFile',file_name,function(err,res){
        if (err){
          console.log(err);
        }
      })
      */
    }
    
    
  }
});

// Tabular does not do well with parent-child relationships with the ReactiveVars so global variable had to be made
Template.Data.onCreated(function () {
  this.selectedTask = selectedTaskG;
  this.selectedData = selectedDataG;
  this.selectedAssignees = selectedAssigneesG;
  this.selectedPreferences = selectedPreferencesG;
  this.change = new ReactiveVar(true);
  this.align = new ReactiveVar(true);
  this.loading = loading;
  //console.log(Data.find());
  //console.log(this);
});

Template.selected.onCreated(function(){
  this.change = new ReactiveVar(true);
  this.align = new ReactiveVar(true);
  this.loading = loading;
});
