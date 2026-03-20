const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Important: Require the shared configuration securely mapped for Node.js
const supportedFileTypes = require('../../shared/constants/supportedFileTypes.json');
const { ALLOWED_MIME_TYPES, MAX_FILE_SIZE, SUPPORTED_EXTENSIONS } = supportedFileTypes;
const ALL_SUPPORTED_EXTENSIONS = Object.values(SUPPORTED_EXTENSIONS).flat();

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

const fileFilter = (req, file, cb) => {
    console.log("Multer processing file:", !!file ? file.originalname : "undefined", "Mimetype:", file.mimetype);

    // Secure Combined Validation: MIME AND Extension must be checked
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');

    // Path 1: E2EE Encrypted Blob bypass
    if (ext === "enc") {
        return cb(null, true);
    }

    // Path 2: Standard Upload (Ensure both MIME and Ext are known)
    const hasValidMime = ALLOWED_MIME_TYPES.includes(file.mimetype);
    const hasValidExt = ALL_SUPPORTED_EXTENSIONS.includes(ext);

    if (hasValidMime && hasValidExt) {
        cb(null, true);
    } else {
        console.error("File rejected by multer. Reason: Failed secure validation.", { name: file.originalname, mime: file.mimetype });
        cb(new Error(`File validation failed. Type or extension not allowed.`));
    }
};

const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE }, // Strictly enforce 100MB limit
    fileFilter,
});

module.exports = upload;
