const express = require('express');
const router = express.Router();
const { getMapsConfig } = require('../controllers/mapsController');

router.get('/config', getMapsConfig);

module.exports = router;
