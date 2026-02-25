// warehouse-system 画像アップロードAPI
// Google Drive に画像を保存し、公開URLを返す

var FOLDER_ID = "1MgIFwpuR5CqZFgyKbJZmt5NGjA_ZnUiL";

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var base64 = data.image;     // "data:image/jpeg;base64,..." or raw base64
    var fileName = data.fileName || ("img_" + new Date().getTime() + ".jpg");

    // data URI prefix を除去
    var match = base64.match(/^data:([^;]+);base64,(.+)$/);
    var mimeType = "image/jpeg";
    var rawBase64 = base64;
    if (match) {
      mimeType = match[1];
      rawBase64 = match[2];
    }

    var blob = Utilities.newBlob(Utilities.base64Decode(rawBase64), mimeType, fileName);
    var folder = DriveApp.getFolderById(FOLDER_ID);
    var file = folder.createFile(blob);

    // リンクを知っている全員が閲覧可能に設定
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var fileId = file.getId();
    var url = "https://drive.google.com/uc?export=view&id=" + fileId;

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      fileId: fileId,
      url: url,
      fileName: file.getName()
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  var action = e.parameter.action;

  if (action === "delete") {
    try {
      var fileId = e.parameter.fileId;
      var file = DriveApp.getFileById(fileId);
      file.setTrashed(true);
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        message: "File moved to trash"
      })).setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: err.toString()
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    message: "Warehouse Image API is running"
  })).setMimeType(ContentService.MimeType.JSON);
}
