const express = require("express");
const router = express.Router();
const AuthController = require("./auth.controller");

router.post("/register", AuthController.register);
router.post("/login", AuthController.login);
router.post("/token", AuthController.generateTokenForRegisteredUser);

module.exports = router;
