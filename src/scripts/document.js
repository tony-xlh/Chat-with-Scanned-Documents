import Dynamsoft from "dwt";
import { createWorker } from 'tesseract.js';
import { getUrlParam } from './utils';
import localForage from "localforage";
import { ConversationalRetrievalQAChain } from "langchain/chains";
import { OpenAI } from "langchain/llms/openai";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { HumanChatMessage } from "langchain/schema";

let DWObject;
let worker;
let resultsDict = {};
let timestamp = undefined;
let store = undefined;
let apikey = "";

const QA_PROMPT = `You are a helpful AI assistant. Use the following pieces of context to answer the question at the end.
If you don't know the answer, just say you don't know. DO NOT try to make up an answer.
If the question is not related to the context, politely respond that you are tuned to only answer questions that are related to the context.
Respond only in the same language of the question.

Context: {context}

Question: {question}
Helpful answer in markdown:`;

const CONDENSE_PROMPT = `Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question.
The rephrased question should be in the original language of the question.

Chat History:
{chat_history}
Follow Up Input: {question}
Standalone question:`;

window.onload = function(){
  initDWT();
  initTesseract();
};

function registerEvents() {
  DWObject.RegisterEvent('OnBufferChanged',function (bufferChangeInfo) {
    const selectedIds = bufferChangeInfo["selectedIds"];
    console.log(bufferChangeInfo);
    if (selectedIds.length === 1) {
      showTextOfPage(DWObject.ImageIDToIndex(selectedIds[0]));
    }
  });

  document.getElementsByClassName("scan-btn")[0].addEventListener("click",async function(){
    if (DWObject) {
      await DWObject.SelectSourceAsync();
      DWObject.AcquireImageAsync();
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

  document.getElementsByClassName("save-btn")[0].addEventListener("click",function(){
    SaveDocument();
  });

  document.getElementsByClassName("save-pdf-btn")[0].addEventListener("click",function(){
    SaveAsPDF();
  });

  document.getElementsByClassName("chat-btn")[0].addEventListener("click",function(){
    ShowChatModal();
  });

  document.getElementById("question").addEventListener("keydown",async function(event){
    if (event.code === "Enter") {
      await Query();
    }
  });
  
  document.getElementsByClassName("close-btn")[0].addEventListener("click",function(){
    HideChatModal();
  });
  

  document.getElementsByClassName("rebuild-btn")[0].addEventListener("click",async function(){
    document.getElementsByClassName("rebuild-btn")[0].innerText = "Building...";
    await CreateVectorStore(getJoinedText());
    document.getElementsByClassName("rebuild-btn")[0].innerText = "Rebuild VectorStore";
  });

  document.getElementsByClassName("set-apikey-btn")[0].addEventListener("click",function(){
    ShowInputModal();
  });

  document.getElementsByClassName("save-apikey-btn")[0].addEventListener("click",function(){
    SaveAPIKey();
  });

  document.getElementsByClassName("query-btn")[0].addEventListener("click",async function(){
    await Query();
  });
}

function showTextOfPage(index){
  if (resultsDict[index]) {
    console.log(resultsDict);
    const text = resultsDict[index].data.text;
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
    LoadProject();
    LoadAPIKey();
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

async function LoadAPIKey() {
  apikey = await localForage.getItem("apikey");
  document.getElementById("apikey").value = apikey;
}

async function OCRSelected(){
  if (DWObject && worker) {
    const index = DWObject.CurrentImageIndexInBuffer;
    const skipProcessed = document.getElementById("skip-processed-chk").checked;
    if (skipProcessed) {
      if (resultsDict[index]) {
        console.log("Processed");
        return;
      }
    }
    const status = document.getElementById("status");
    status.innerText = "Recognizing...";
    const data = await OCROneImage(index);
    resultsDict[index] = data;
    status.innerText = "Done";
    showTextOfPage(index);
  }
}

async function BatchOCR(){
  if (DWObject && worker) {
    const skipProcessed = document.getElementById("skip-processed-chk").checked;
    const status = document.getElementById("status");
    for (let index = 0; index < DWObject.HowManyImagesInBuffer; index++) {
      if (skipProcessed) {
        if (resultsDict[index]) {
          console.log("Processed");
          continue;
        }
      }
      status.innerText = "Recognizing page "+(index+1)+"...";
      const data = await OCROneImage(index);
      resultsDict[index] = data;
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
  let text = getJoinedText();
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

function getJoinedText(){
  let text = "";
  if (DWObject) {
    for (let index = 0; index < DWObject.HowManyImagesInBuffer; index++) {
      if (resultsDict[index]) {
        text = text + resultsDict[index].data.text;
      }
      text = text + "\n\n=== "+ "Page "+ (index+1) +" ===\n\n";
    }
  }
  return text;
}

async function SaveDocument() {
  document.getElementsByClassName("save-btn")[0].innerText = "Saving...";
  if (!timestamp) {
    timestamp = Date.now();
  }
  await SaveOCRResults(timestamp);
  await SavePages(timestamp);
  document.getElementsByClassName("save-btn")[0].innerText = "Save to IndexedDB";
  alert("Saved");
}

async function SaveOCRResults(timestamp){
  await localForage.setItem(timestamp+"-OCR-Data",resultsDict);
}

function SavePages(timestamp){
  return new Promise(function (resolve, reject) {
    if (DWObject) {
      const success = async (result) => {
        await localForage.setItem(timestamp+"-PDF",result);
        resolve();
      };
      const failure = (errorCode, errorString) => {
        reject(errorString);
      };
      DWObject.ConvertToBlob(getAllImageIndex(),Dynamsoft.DWT.EnumDWT_ImageType.IT_PDF, success, failure);
    }else{
      reject();
    }
  });
}

function SaveAsPDF(){
  if (DWObject) {
    DWObject.SaveAllAsPDF(
      "Scanned",
      function() {
        console.log("saved");
      },
      function() {
        console.log("failed");
      }
    );
  }
  
}

async function SaveAPIKey(){
  apikey = document.getElementById("apikey").value;
  await localForage.setItem("apikey",apikey);
  document.getElementsByClassName("input-modal")[0].classList.remove("active");
}

function getAllImageIndex(){
  let indices = [];
  if (DWObject) {
    for (let index = 0; index < DWObject.HowManyImagesInBuffer; index++) {
      indices.push(index);
    }
  }
  return indices;
}



async function LoadProject(){
  timestamp = getUrlParam("timestamp");
  if (timestamp) {
    const OCRData = await localForage.getItem(timestamp+"-OCR-Data");
    if (OCRData) {
      resultsDict = OCRData;
    }
    const PDF = await localForage.getItem(timestamp+"-PDF");
    if (PDF) {
      if (DWObject) {
        DWObject.LoadImageFromBinary(
          PDF,
          function () {
            console.log("success");
          },
          function (errorCode, errorString) {
            console.log(errorString);
          }
        );
      }
    }
  }
}

async function ShowChatModal(){
  document.getElementsByClassName("modal")[0].classList.add("active");
  const key = await localForage.getItem("apikey");
  if (!key) {
    ShowInputModal();
  }
}

async function HideChatModal(){
  document.getElementsByClassName("modal")[0].classList.remove("active");
}

function ShowInputModal(){
  document.getElementsByClassName("input-modal")[0].classList.add("active");
}

async function Query(){
  console.log('query');
  const question = document.getElementById("question").value;
  if (question) {
    let history = [];

    const chatWindow = document.getElementsByClassName("chat-window")[0];
    // get divs with className question in chatWindow and set history array
    history = getChatHistory(chatWindow);


    let answer = "";
    appendDialog("Q: "+question);
    appendDialog("Please wait...");
    chatWindow.scrollTo(0,chatWindow.scrollHeight);

    document.getElementById("question").value = "";
    const text = getJoinedText();
    if (text) {
      if (!store) {
        await CreateVectorStore(text);
      }
      const model = new OpenAI({
        openAIApiKey: apikey, 
        temperature: 0, // increase temepreature to get more creative answers
        modelName: 'gpt-3.5-turbo', //change this to gpt-4 if you have access
      });

      const chain = ConversationalRetrievalQAChain.fromLLM(
        model, store.asRetriever(), {
          qaTemplate: QA_PROMPT,
          questionGeneratorTemplate: CONDENSE_PROMPT,
          returnSourceDocuments: true
        }
      );
  
      console.log('call to chain 1');
        // OpenAI recommends replacing newlines with spaces for best results
      const sanitizedQuestion = question.trim().replaceAll('\n', ' ');

      //Ask a question using chat history
      const res = await chain.call({
        question: sanitizedQuestion,
        chat_history: history || [], 
      });

      answer = res.text;
    }else{
      const chat = new ChatOpenAI({ openAIApiKey: apikey, temperature: 0 });
      console.log('call to chain 2');
      const response = await chat.call([
        new HumanChatMessage(
          question
        ),
      ]);
      answer = response.text;
    }
    
    console.log('append response');
    chatWindow.removeChild(chatWindow.childNodes[chatWindow.childNodes.length - 1]);
    appendDialog("A: "+answer);
    chatWindow.scrollTo(0,chatWindow.scrollHeight);
  }
}

function getChatHistory(chatWindow) {
  let history = [];
  const questions = chatWindow.getElementsByClassName("question");
  for (let index = 0; index < questions.length; index++) {
    const element = questions[index];
    // add to innerText to histoty
    history.push(element.innerText);
  }
  return history;
}

function appendDialog(text){
  const chatWindow = document.getElementsByClassName("chat-window")[0];
  const questionContainer = document.createElement("div");
  questionContainer.className = "question";
  const dialogContainer = document.createElement("div");
  dialogContainer.className = "dialog";
  questionContainer.appendChild(dialogContainer);
  dialogContainer.innerText = text;
  chatWindow.appendChild(questionContainer);
}

async function CreateVectorStore(text){
  // Create the models and chain
  const embeddings = new OpenAIEmbeddings({openAIApiKey: apikey});
  // Load the documents and create the vector store
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 4000,
    chunkOverlap: 200,
  });
  const docs = await splitter.createDocuments([text]);
  console.log(splitter);
  console.log(docs);
  store = await MemoryVectorStore.fromDocuments(docs, embeddings);
  console.log(store);
  return store;
}
