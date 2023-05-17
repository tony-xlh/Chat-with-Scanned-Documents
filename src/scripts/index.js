import '../styles/index.scss';
import Dynamsoft from "dwt";
import { createWorker } from 'tesseract.js';

let DWObject;
let worker;
let resultsDict = {};

window.onload = function(){
  initDWT();
  initTesseract();
};

function registerEvents() {
  DWObject.RegisterEvent('OnBufferChanged',function (bufferChangeInfo) {
    const selectedIds = bufferChangeInfo["selectedIds"];
    console.log(bufferChangeInfo);
    if (selectedIds.length === 1) {
      showTextOfPage(selectedIds[0]);
    }
  });

  document.getElementsByClassName("scan-btn")[0].addEventListener("click",function(){
    if (DWObject) {
      DWObject.SelectSource(function () {
        DWObject.OpenSource();
        DWObject.AcquireImage();
      },
        function () {
          console.log("SelectSource failed!");
        }
      );
    }
  });
  document.getElementsByClassName("load-btn")[0].addEventListener("click",function(){
    if (DWObject) {
      DWObject.IfShowFileDialog = true;
      // PDF Rasterizer Addon is used here to ensure PDF support
      DWObject.Addon.PDF.SetResolution(200);
      DWObject.Addon.PDF.SetConvertMode(Dynamsoft.DWT.EnumDWT_ConvertMode.CM_RENDERALL);
      DWObject.LoadImageEx("", Dynamsoft.DWT.EnumDWT_ImageType.IT_ALL);
    }
  });

  document.getElementsByClassName("edit-btn")[0].addEventListener("click",function(){
    if (DWObject) {
      let imageEditor = DWObject.Viewer.createImageEditor();
      imageEditor.show();
    }
  });

  document.getElementsByClassName("ocr-btn")[0].addEventListener("click",function(){
    OCRSelected();
  });

  document.getElementsByClassName("batch-ocr-btn")[0].addEventListener("click",function(){
    BatchOCR();
  });

  document.getElementsByClassName("download-text-btn")[0].addEventListener("click",function(){
    DownloadText();
  });
}

function showTextOfPage(ImageID){
  console.log(ImageID);
  if (resultsDict[ImageID]) {
    console.log(resultsDict);
    const text = resultsDict[ImageID].data.text;
    document.getElementsByClassName("text")[0].innerText = text;
  }else{
    document.getElementsByClassName("text")[0].innerText = "";
  }
}

function initDWT(){
  const containerID = "dwtcontrolcontainer";
  Dynamsoft.DWT.RegisterEvent('OnWebTwainReady', () => {
    DWObject = Dynamsoft.DWT.GetWebTwain(containerID);
    DWObject.Viewer.width = "100%";
    DWObject.Viewer.height = "100%";
    registerEvents();
  });
  
  Dynamsoft.DWT.ResourcesPath = "/dwt-resources";
  Dynamsoft.DWT.Containers = [{
      WebTwainId: 'dwtObject',
      ContainerId: containerID
  }];
  Dynamsoft.DWT.Load();
}

async function initTesseract(){
  const status = document.getElementById("status");
  status.innerText = "Loading tesseract core...";
  worker = await createWorker({
    logger: m => console.log(m)
  });
  status.innerText = "Loading lanuage model...";
  await worker.loadLanguage('eng');
  status.innerText = "Initializing...";
  await worker.initialize('eng');
  status.innerText = "Ready";
}

async function OCRSelected(){
  if (DWObject && worker) {
    const index = DWObject.CurrentImageIndexInBuffer;
    const skipProcessed = document.getElementById("skip-processed-chk").checked;
    const ImageID = DWObject.IndexToImageID(index);
    if (skipProcessed) {
      if (resultsDict[ImageID]) {
        console.log("Processed");
        return;
      }
    }
    const status = document.getElementById("status");
    status.innerText = "Recognizing...";
    const data = await OCROneImage(index);
    resultsDict[ImageID] = data;
    status.innerText = "Done";
    showTextOfPage(ImageID);
  }
}

async function BatchOCR(){
  if (DWObject && worker) {
    const skipProcessed = document.getElementById("skip-processed-chk").checked;
    const status = document.getElementById("status");
    for (let index = 0; index < DWObject.HowManyImagesInBuffer; index++) {
      const ImageID = DWObject.IndexToImageID(index);
      if (skipProcessed) {
        if (resultsDict[ImageID]) {
          console.log("Processed");
          continue;
        }
      }
      status.innerText = "Recognizing page "+(index+1)+"...";
      const data = await OCROneImage(index);
      resultsDict[ImageID] = data;
    }
    status.innerText = "Done";
  }
}

async function OCROneImage(index){
  return new Promise(function (resolve, reject) {
    if (DWObject) {
      const success = async (result) => {
        const data = await worker.recognize(result);
        resolve(data);
      };
      const failure = (errorCode, errorString) => {
        reject(errorString);
      };
      DWObject.ConvertToBlob([index],Dynamsoft.DWT.EnumDWT_ImageType.IT_JPG, success, failure);
    }else{
      reject("Not initialized");
    }
  });
}

function DownloadText(){
  if (DWObject) {
    let text = "";
    for (let index = 0; index < DWObject.HowManyImagesInBuffer; index++) {
      const ImageID = DWObject.IndexToImageID(index);
      if (resultsDict[ImageID]) {
        text = text + resultsDict[ImageID].data.text;
      }
      text = text + "\n\n=== "+ "Page "+ (index+1) +" ===\n\n";
    }
    let filename = 'text.txt';
    let link = document.createElement('a');
    link.style.display = 'none';
    link.setAttribute('target', '_blank');
    link.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
