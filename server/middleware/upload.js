const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    },
});

const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/jpg",
    "image/webp",
    "application/pdf",
    "application/zip",
    "application/x-zip-compressed",
    "video/mp4",
    "application/octet-stream" // fallback for E2EE blobs
];

const fileFilter = (req, file, cb) => {
    console.log("Multer processing file:", !!file ? file.originalname : "undefined", "Mimetype:", file.mimetype);

    // Some E2EE blobs might arrive as generic application/octet-stream.
    // We allow standard types and octet streams.
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        // Fallback to checking extension if mimetype is weird
        const extRegex = /jpeg|jpg|png|gif|mp4|avi|webm|mov|mkv|wmv|flv|pdf|doc|docx|txt|xls|xlsx|ppt|pptx|zip|rar|mp3|wav|mpeg|enc/;
        const extMatch = extRegex.test(path.extname(file.originalname).toLowerCase());

        if (extMatch) {
            cb(null, true);
        } else {
            console.error("File rejected by multer:", file.originalname, file.mimetype);
            cb(new Error(`File type not allowed: ${file.mimetype}`));
        }
    }
};

const upload = multer({
    storage,
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
    fileFilter,
});

module.exports = upload;
