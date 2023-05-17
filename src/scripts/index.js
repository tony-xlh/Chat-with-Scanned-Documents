import localForage from "localforage";

ListScannedDocuments();


async function ListScannedDocuments(){
  let documents = document.getElementsByClassName("documents")[0];
  const keys = await localForage.keys();
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    if (key.endsWith("PDF")) {
      const timestamp = key.substring(0,13);
      AddOneDocumentItem(timestamp,documents);
    }
  }
}

function AddOneDocumentItem(timestamp,parent) {
  let listItem = document.createElement("li");
  let link = document.createElement("a");
  link.href = "document.html?timestamp="+timestamp;
  link.target = "_blank";
  link.innerText = new Date(timestamp).toLocaleString();
  listItem.appendChild(link);
  parent.appendChild(listItem);
}