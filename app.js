'use strict';

var
    http = require('http'),
    url = require('url'),
    querystring = require('querystring'),
    fs = require('fs'),
    path = require('path'),
    nodehun = require('nodehun'),
    debug = require('debug')('httpspell'),
    DEBUG = !!debug.enabled;

// change current working directory for later use of 'process.cwd()'
process.chdir(__dirname);

var config = {
    http: {
        port: 3001,
        host: 'localhost',
        root: 'app'
    },
    dict: {
        base: 'dict',
        lang: 'ko'
    }
};

var dictCache = {};

//
//
//

function loadDict(lang, callback) {
    lang = lang || config.dict.lang;
    var dict = dictCache[lang];
    if (dict) {
        DEBUG && debug('load dict from cached: lang=' + lang);
        return callback(null, dict);
    }
    var affFile = path.join(path.resolve(process.cwd(), config.dict.base), lang + '.aff');
    fs.readFile(affFile, function (err, affBuf) {
        if (err) {
            DEBUG && debug('readFile err: ', err, 'affFile=' + affFile);
            return callback(err);
        }
        var dicFile = path.join(path.resolve(process.cwd(), config.dict.base), lang + '.dic');
        fs.readFile(dicFile, function (err, dicBuf) {
            if (err) {
                DEBUG && debug('readFile err: ', err, 'dicFile=' + dicFile);
                return callback(err);
            }
            nodehun.createNewNodehun(affBuf, dicBuf, function (dict) {
                DEBUG && debug('createNewNodehun ok: ', arguments);
                if (!dict) {
                    return callback('createnewNodehun error');
                }
                dictCache[lang] = dict;
                DEBUG && debug('create new dict: lang=' + lang + ',aff=' + affFile + ',dic=' + dicFile);
                return callback(err, dict);
            });
        });
    });
}

//
//
//

function parseRequestBody(req, res, callback) {
    req.body = '';
    req.on('data', function (data) {
        req.body += data;
    });
    req.on('end', function () {
        switch (req.headers['Content-Type']) {
            case 'application/x-www-form-urlencoded':
                req.body = querystring.parse(req.body);
                break;
            case 'application/json':
                req.body = JSON.stringify(req.body);
                break;
        }
        return callback(req, res);
    });
}

function parseRequest(req, res, callback) {
    var uri = url.parse(req.url, true);
    req.path = uri.pathname;
    req.query = uri.query || {};
    req.body = '';
    switch (req.method) {
        case 'POST':
        case 'PUT':
            parseRequestBody(req, res, callback);
            break;
        //case 'GET':
        //case 'DELETE':
        default:
            callback(req, res);
            break;
    }
}

function sendResult(req, res, result) {
    res.writeHead(200, {'Content-Type': 'application/json;charset=UTF-8'});
    res.end(JSON.stringify({result: result}));
}

function sendError(req, res, error) {
    res.writeHead(error.status || 500, {'Content-Type': 'application/json;charset=UTF-8'});
    res.end(JSON.stringify({error: error}));
}

function sendStaticFile(req, res) {
    var filePath = path.join(path.resolve(process.cwd(), config.http.root), (req.path !== '' && req.path !== '/') ? req.path : '/index.html');
    DEBUG && debug('send static file: ', req.path, '--->', filePath);
    fs.exists(filePath, function (exists) {
        if (!exists) {
            return sendError(req, res, {status: 404, message: 'FILE NOT FOUND'});
        }
        fs.readFile(filePath, function (err, data) {
            if (err) {
                return sendError(req, res, {status: 500, message: 'FILE READ ERROR', cause: err});
            }
            res.writeHead(200);
            return res.end(data);
        });
    });
}

//
//
//

function getLang(req) {
    return req.query.lang || req.body.lang;
}

var WORD_SEPARATOR = /[^\w가-힣]+/;

function getWords(req) {
    return (req.query.text || req.body.text || '').split(WORD_SEPARATOR);
}

function doSuggest(req, res) {
    loadDict(getLang(req), function (err, dict) {
        if (err) {
            return sendError(req, res, {status: 400, message: 'DICTIONARY LOAD ERROR', cause: err});
        }
        var result = [];
        var words = getWords(req);
        var count = 0;
        words.forEach(function (word, i) {
            dict.spellSuggestions(word, function (correct, suggestions) {
                DEBUG && debug('suggest: ', word, '---->', arguments);
                result[i] = {word: word, correct: correct, suggest: suggestions};
                if (++count === words.length) {
                    DEBUG && debug('suggest result:', result);
                    return sendResult(req, res, result);
                }
            });
        });
    });
}

function doCheck(req, res) {
    loadDict(getLang(req), function (err, dict) {
        if (err) {
            return sendError(req, res, {status: 400, message: 'DICTIONARY LOAD ERROR', cause: err});
        }
        var result = [];
        var words = getWords(req);
        var count = 0;
        words.forEach(function (word, i) {
            dict.spellSuggest(word, function (correct, suggest) {
                DEBUG && debug('check: ', word, '---->', arguments);
                result[i] = {word: word, correct: correct, suggest: suggest};
                if (++count === words.length) {
                    DEBUG && debug('check result:', result);
                    return sendResult(req, res, result);
                }
            });
        }, []);
    });
}

function dispatchRequest(req, res) {
    switch (req.path) {
        case '/suggest':
            doSuggest(req, res);
            break;
        case '/check':
            doCheck(req, res);
            break;
        default:
            sendStaticFile(req, res);
            break;
    }
}

function startServer() {
    http.createServer(function (req, res) {
        DEBUG && debug('>>>', req.url);
        parseRequest(req, res, dispatchRequest);
    }).listen(config.http.port, config.http.host);
}

//
// ***CLI ENTRY POINT***
//

if (require.main === module) {
    startServer();
}
