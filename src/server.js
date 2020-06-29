// System
// Node Cache
const NodeCache = require("node-cache");
const myCache = new NodeCache();
// UUID
const {
    v4: uuidv4
} = require('uuid');
//File system
const fs = require('fs');
// HTTPS
const https = require('https');
const privateKey = fs.readFileSync('/etc/letsencrypt/live/rpc.ssvm.secondstate.io/privkey.pem', 'utf8');
const certificate = fs.readFileSync('/etc/letsencrypt/live/rpc.ssvm.secondstate.io/cert.pem', 'utf8');
const ca = fs.readFileSync('/etc/letsencrypt/live/rpc.ssvm.secondstate.io/fullchain.pem', 'utf8');
const helmet = require("helmet");
const credentials = {
    key: privateKey,
    cert: certificate,
    ca: ca
};
// Buffer string to array
const converter = require('buffer-string-to-array')
// Express
const express = require('express');
const app = express();
app.use(helmet());
// Body parser
var bodyParser = require('body-parser');
app.use(bodyParser.text({
    type: "text/plain",
    limit: 100000000
}));
app.use(bodyParser.json({
    type: "application/json"
}));
app.use(bodyParser.raw({
    type: "application/octet-stream",
    limit: 100000000
}));

// Config
require('dotenv').config();
//Port
const port = process.env.port;
// Data ser/des
app.use(express.json());
app.use(express.urlencoded({
    extended: true
}));
// CORS
var cors = require('cors');
app.use(cors());
// Database
console.log("Connecting to database, please wait ... ");
const mysql = require('mysql');
const connection = mysql.createConnection({
    host: process.env.db_host,
    user: process.env.db_user,
    password: process.env.db_password,
    database: process.env.db_name
});
connection.connect((err) => {
    if (err) throw err;
    console.log('Connection to database succeeded!');
});

// Logging
// 0 equals no logging
// 1 equals logging
console.log("Setting log level ...");
const log_level = process.env.log_level;

// Filtering the content types which are allowed to access Joey
app.use(function(req, res, next) {
    if (req.method === 'POST') {
        if (req.is('application/octet-stream' !== 'application/octet-stream') || req.is('application/json' !== 'application/json') || req.is('text/plain' !== 'text/plain')) {
            return res.send(406);
        }
    }
    next();
});

// Multipart form data
const formidable = require('formidable');


// SSVM
var ssvm = require('ssvm');

// Checksum
const checksum = require('crypto');

/* Startup */
// Serve
https.createServer(credentials, app).listen(port, process.env.host, () => {
    console.log(`Welcome to wasm-joey` + '\nHost:' + process.env.host + '\nPort: ' + port);
    console.log("Reading database configuration, please wait ... ");
    console.log("Database host: " + process.env.db_host);
    console.log("Database port: " + process.env.db_port);
    console.log("Database name: " + process.env.db_name);
    console.log("Database user: " + process.env.db_user);
    console.log("\n");
});
/* End Startup*/

/* Utils */


function isValidJSON(text) {
    return new Promise(function(resolve, reject) {
        if (typeof text !== "string") {
            console.log("Not a JSON string");
            resolve(false);
        }
        try {
            JSON.parse(text);
            resolve(true);
        } catch (error) {
            resolve(false);
        }
    });
}

function removeElementFromArray(arr, value) {
    return arr.filter(function(ele) {
        return ele != value;
    });
}

function performSqlQuery(string_query) {
    return new Promise(function(resolve, reject) {
        connection.query(string_query, function(err, resultSelect) {
            if (err) {
                res.status(400).send("Perhaps a bad request, or database is not running");
            }
            //console.log("Result of select: " + resultSelect.length);
            resolve(resultSelect);
        });
    });
}

function executableExists(wasm_id) {
    return new Promise(function(resolve, reject) {
        connection.query("select wasm_id from wasm_executables where wasm_id='" + wasm_id + "';", function(err, resultSelect) {
            if (err) {
                res.status(400).send("Perhaps a bad request, or database is not running");
            }
            //console.log("Result of select: " + resultSelect.length);
            resolve(resultSelect.length);
        });
    });
}

function executionLogExists(wasm_id) {
    return new Promise(function(resolve, reject) {
        connection.query("select log_id from wasm_execution_log where wasm_executable_id='" + wasm_id + "';", function(err, resultSelect) {
            if (err) {
                res.status(400).send("Perhaps a bad request, or database is not running");
            }
            //console.log("Result of select: " + resultSelect.length);
            resolve(resultSelect.length);
        });
    });
}

function executeCallbackRequest(_original_id, _request_options) {
    return new Promise(function(resolve, reject) {
        if (log_level == 1) {
            var sqlSelect = "SELECT wasm_state FROM wasm_executables WHERE wasm_id = '" + _original_id + "';";
            performSqlQuery(sqlSelect).then((stateResult) => {
                var logging_object = {};
                logging_object["original_wasm_executables_id"] = _original_id;
                logging_object["callback_request_options"] = _request_options;
                var sqlInsert = "INSERT INTO wasm_execution_log (wasm_executable_id, wasm_executable_state, execution_timestamp, execution_object) VALUES ('" + _original_id + "', '" + stateResult[0].wasm_state + "', NOW(), '" + JSON.stringify(logging_object) + "');";
                performSqlQuery(sqlInsert).then((resultInsert) => {
                    //console.log("Logging updated");
                });
            });
        }
        var options = JSON.parse(_request_options);
        const data = JSON.stringify(options["body"]);
        delete options.body;
        options["headers"]["Content-Length"] = data.length;
        const req = https.request(options, (res) => {
            let data = '';

            //console.log('Status Code:', res.statusCode);

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on("end", () => {
                try {
                    resolve(data);
                } catch (error) {
                    console.error(error.message);
                };
            });

        }).on("error", (err) => {
            console.log("Error: ", err.message);
        });

        req.write(data);
        req.end();
    });
}

function executeMultipartRequest(_original_id, _request_options) {
    return new Promise(function(resolve, reject) {
        if (log_level == 1) {
            var sqlSelect = "SELECT wasm_state FROM wasm_executables WHERE wasm_id = '" + _original_id + "';";
            performSqlQuery(sqlSelect).then((stateResult) => {
                var logging_object = {};
                logging_object["original_wasm_executables_id"] = _original_id;
                logging_object["callback_request_options"] = _request_options[1];
                var sqlInsert = "INSERT INTO wasm_execution_log (wasm_executable_id, wasm_executable_state, execution_timestamp, execution_object) VALUES ('" + _original_id + "', '" + stateResult[0].wasm_state + "', NOW(), '" + JSON.stringify(logging_object) + "');";
                performSqlQuery(sqlInsert).then((resultInsert) => {
                    //console.log("Logging updated");
                });
            });
        }
        var options = JSON.parse(_request_options[1]);
        const data = JSON.stringify(options["body"]);
        delete options.body;
        options["headers"]["Content-Length"] = data.length;
        const req = https.request(options, (res) => {
            let data = '';

            //console.log('Status Code:', res.statusCode);

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on("end", () => {
                try {
                    var dict_return = {};
                    dict_return[_request_options[0]] = data;
                    resolve(JSON.stringify(dict_return));
                } catch (error) {
                    console.error(error.message);
                };
            });

        }).on("error", (err) => {
            console.log("Error: ", err.message);
        });

        req.write(data);
        req.end();
    });
}

function fetchUsingGet(_info) {
    return new Promise(function(resolve, reject) {
        https.get(_info[1], (res) => {
            let body = "";
            res.on("data", (chunk) => {
                body += chunk;
            });
            res.on("end", () => {
                try {
                    var dict_return = {};
                    dict_return[_info[0]] = body;
                    //console.log("Returning: " + JSON.stringify(dict_return));
                    resolve(JSON.stringify(dict_return));
                } catch (error) {
                    console.error(error.message);
                };
            });

        }).on("error", (error) => {
            console.error(error.message);
        });
    });
}

function readTheFile(_file) {
    return new Promise(function(resolve, reject) {
        var file_path = _file[1]["path"];
        fs.readFile(file_path, (err, data) => {
            //console.log("readTheFile() is being executed ...");
            if (err) {
                console.log("err ocurred", err);
            } else {
                var return_data = {};
                return_data[_file[0]] = data;
                resolve(JSON.stringify(return_data));
            }
        });
    });
}

function parseMultipart(_readyAtZero, _files, _fields, _req) {
    return new Promise(function(resolve, reject) {
        //console.log("parseMultipart function is being executed ...");
        //console.log("There are " + Object.keys(_files).length + " files to process");
        for (var file of Object.entries(_files)) {
            readTheFile(file).then((file_read_result, file_read_error) => {
                if (!file_read_error) {
                    fetched_result_object = JSON.parse(file_read_result);
                    const _string_position = Object.keys(fetched_result_object)[0].lastIndexOf("_");
                    const index_key = Object.keys(fetched_result_object)[0].slice(_string_position + 1, Object.keys(fetched_result_object)[0].length);
                    _readyAtZero.container[index_key] = fetched_result_object[Object.keys(fetched_result_object)[0]]["data"];
                    _readyAtZero.decrease();
                    if (_readyAtZero.isReady()) {
                        resolve("{}");
                    }
                } else {
                    console.log(file_read_error);
                }
            });
        }
        for (var field of Object.entries(_fields)) {
            if (field[0].startsWith("fetch")) {
                if (field[1].startsWith("http")) {
                    fetchUsingGet(field).then((fetched_result, error) => {
                        fetched_result_object = JSON.parse(fetched_result);
                        const _string_position = Object.keys(fetched_result_object)[0].lastIndexOf("_");
                        const index_key = Object.keys(fetched_result_object)[0].slice(_string_position + 1, Object.keys(fetched_result_object)[0].length);
                        _readyAtZero.container[index_key] = JSON.stringify(fetched_result_object[Object.keys(fetched_result_object)[0]]);
                        _readyAtZero.decrease();
                        if (_readyAtZero.isReady()) {
                            resolve("{}");
                        }
                    });
                } else {
                    executeMultipartRequest(_req.params.wasm_id, field).then((fetched_result2, error) => {
                        fetched_result_object2 = JSON.parse(fetched_result2);
                        const _string_position2 = Object.keys(fetched_result_object2)[0].lastIndexOf("_");
                        const index_key2 = Object.keys(fetched_result_object2)[0].slice(_string_position2 + 1, Object.keys(fetched_result_object2)[0].length);
                        _readyAtZero.container[index_key2] = JSON.stringify(fetched_result_object2[Object.keys(fetched_result_object2)[0]]);
                        _readyAtZero.decrease();
                        if (_readyAtZero.isReady()) {
                            resolve("{}");
                        }
                    });
                }
            } else if (field[0].startsWith("SSVM_Callback")) {
                console.log("Found SSVM_Callback");
                console.log(JSON.stringify(JSON.parse(field[1])));
                resolve(JSON.stringify(JSON.parse(field[1])));
            } else {
                const _string_position3 = field[0].lastIndexOf("_");
                const index_key3 = field[0].slice(_string_position3 + 1, field[0].length);
                _readyAtZero.container[index_key3] = JSON.stringify(field[1]);
                _readyAtZero.decrease();
                if (_readyAtZero.isReady()) {
                    resolve("{}");
                }
            }

        }
    });
}

class ReadyAtZero {
    constructor(_items) {
        this.value = _items;
        //console.log(this.value);
        this.container = {};
    }
    decrease() {
        this.value = this.value - 1;
        //console.log(this.value);
    }
    increase() {
        this.value = this.value + 1;
        //console.log(this.value);
    }
    isReady() {
        //console.log(this.value);
        if (this.value == 0) {
            return true;
        } else {
            return false;
        }
    }
}
/* Utils end */

/* Ephemeral storage endpoints - cached in memory */
// Default ephemeral storage lasts for 1 hour (3600 seconds)
// TTL is refreshed back to 1 hour if the data us updated, otherwise is expires and is deleted

// Post data to ephmeral storage location
app.post('/api/ephemeral_storage', bodyParser.json(), (req, res) => {
    joey_response = {};
    if (req.is('application/json') == 'application/json') {
        console.log(req.body.data);
        isValidJSON(JSON.stringify(req.body)).then((result, error) => {
            if (result == true) {
                var new_key = uuidv4();
                success = myCache.set(new_key, req.body, 3600);
                joey_response["key"] = new_key;
                res.send(JSON.stringify(joey_response));

            } else {
                joey_response["error"] = "Not valid JSON";
                res.send(JSON.stringify(joey_response));
            }
        });
    } else {
        joey_response["error"] = "Mime type in request headers must be application/json";
        res.send(JSON.stringify(joey_response));
    }
});
// Get content at ephemeral storage location
app.get('/api/ephemeral_storage/:key', (req, res) => {
    var joey_response = {};
    var value = myCache.get(req.params.key);
    if (value == undefined) {
        joey_response["error"] = "Key not found";
        res.send(JSON.stringify(joey_response));
    } else {
        joey_response["value"] = value;
        res.send(JSON.stringify(joey_response));
    }
});
// Update data at ephemeral storage location
app.put('/api/ephemeral_storage/:key', bodyParser.json(), (req, res) => {
    joey_response = {};
    if (req.is('application/json') == 'application/json') {
        isValidJSON(JSON.stringify(req.body)).then((result, error) => {
            if (result == true) {
                success = myCache.set(req.params.key, req.body, 3600);
                joey_response["key"] = req.params.key;
                res.send(JSON.stringify(joey_response));
            } else {
                joey_response["error"] = "Not valid JSON";
                res.send(JSON.stringify(joey_response));
            }
        });
    } else {
        joey_response["error"] = "Mime type in request headers must be application/json";
        res.send(JSON.stringify(joey_response));
    }
});
// Delete data at ephemeral storage location
app.delete('/api/ephemeral_storage/:key', (req, res) => {
    joey_response = {};
    value = myCache.del(req.params.key);
    joey_response["key"] = req.params.key;
    res.send(JSON.stringify(joey_response));
});

/* Main application endpoints */

app.get('/', (req, res) => {
    joey_response = [{
        "application": "wasm_joey"
    }, {
        "usage_documentation:": "https://github.com/second-state/wasm-joey/blob/master/documentation/usage.md"
    }];
    res.send(JSON.stringify(joey_response));
});

// Set a Wasm executable
app.post('/api/executables', bodyParser.raw(), (req, res) => {
    joey_response = {};
    //console.log("Request to set a new wasm hex into the database ...");
    if (req.is('application/octet-stream') == 'application/octet-stream') {
        //var wasm_as_string = Uint8Array.from(req.body).toString();
        var wasm_as_buffer = Uint8Array.from(req.body);
        console.log(wasm_as_buffer);
        //var sqlInsert = "INSERT INTO wasm_executables (wasm_description,wasm_binary, wasm_state) VALUES ('" + req.header('SSVM_Description') + "','" + wasm_as_string + "', '{}');";
        var sqlInsert = "INSERT INTO wasm_executables (wasm_description,wasm_binary, wasm_state, wasm_callback_object) VALUES ('" + req.header('SSVM_Description') + "','" + wasm_as_buffer + "', '{}', '{}');";
        console.log(sqlInsert);
        performSqlQuery(sqlInsert).then((resultInsert) => {
            console.log("1 record inserted at wasm_id: " + resultInsert.insertId);
            joey_response["wasm_id"] = resultInsert.insertId;
            joey_response["wasm_sha256"] = "0x" + checksum.createHash('sha256').update(wasm_as_buffer.toString()).digest('hex');
            res.send(JSON.stringify(joey_response));
        });
    }
});

// Get a Wasm executable
app.get('/api/executables/:wasm_id', (req, res) => {
    joey_response = {};
    executableExists(req.params.wasm_id).then((result, error) => {
        //console.log("Result:" + result + ".");
        if (result == 1) {
            var valid_filters = ["wasm_id", "wasm_description", "wasm_as_buffer", "wasm_state", "wasm_sha256", "wasm_callback_object"];
            var request_validity = true;
            if (req.query.filterBy != undefined) {
                try {
                    var filters = JSON.parse(req.query.filterBy);
                } catch {
                    joey_response["error"] = "Please check your filterBy parameters. Not valid string array!";
                    res.send(JSON.stringify(joey_response));
                    res.end();
                }
                //console.log(filters);
                if (filters.length >= 1) {
                    for (var i = 0; i < filters.length; i++) {
                        if (!valid_filters.includes(filters[i])) {
                            console.log(filters[i] + " is NOT a valid filter ...");
                            request_validity = false;
                        } else {
                            console.log(filters[i] + " is a valid filter ...");
                        }
                    }
                    if (request_validity == false) {
                        res.send(JSON.stringify([{
                            "error_invalid_filter": JSON.stringify(filters)
                        }, {
                            "valid_filters_include": valid_filters
                        }]));
                    } else {
                        // We need to perform separate select query for complex objects (LONGBLOB & LONGTEXT etc.)
                        if (filters.length >= 1) {
                            if (filters.includes("wasm_as_buffer")) {
                                filters = removeElementFromArray(filters, "wasm_as_buffer");
                                var sqlSelect = "SELECT wasm_binary from wasm_executables WHERE wasm_id = '" + req.params.wasm_id + "';";
                                //console.log(sqlSelect);
                                performSqlQuery(sqlSelect).then((result) => {
                                    joey_response["wasm_as_buffer"] = result[0].wasm_binary;
                                    if (filters.length == 0) {
                                        res.send(JSON.stringify(joey_response));
                                    }
                                });
                            }
                        }
                        // We need to perform separate select query for complex objects (LONGBLOB & LONGTEXT etc.)
                        if (filters.length >= 1) {
                            if (filters.includes("wasm_sha256")) {
                                filters = removeElementFromArray(filters, "wasm_sha256");
                                var sqlSelect = "SELECT wasm_binary from wasm_executables WHERE wasm_id = '" + req.params.wasm_id + "';";
                                //console.log(sqlSelect);
                                performSqlQuery(sqlSelect).then((result) => {
                                    joey_response["wasm_sha256"] = "0x" + checksum.createHash('sha256').update(result[0].wasm_binary.toString()).digest('hex');
                                    if (filters.length == 0) {
                                        res.send(JSON.stringify(joey_response));
                                    }
                                });
                            }
                        }
                        // We can join the simple objects i.e. char and just perform one select query for these
                        if (filters.length >= 1) {
                            //console.log("Select by joining the following filters: " + filters.join());
                            var sqlSelect = "SELECT " + filters.join() + " from wasm_executables WHERE wasm_id = '" + req.params.wasm_id + "';";
                            //console.log("SQL with filters.join()\n" + sqlSelect);
                            performSqlQuery(sqlSelect).then((result) => {
                                if (filters.includes("wasm_id")) {
                                    joey_response["wasm_id"] = result[0].wasm_id;
                                }
                                if (filters.includes("wasm_description")) {
                                    joey_response["wasm_description"] = result[0].wasm_description;
                                }
                                if (filters.includes("wasm_state")) {
                                    joey_response["wasm_state"] = result[0].wasm_state;
                                }
                                if (filters.includes("wasm_callback_object")) {
                                    joey_response["wasm_callback_object"] = result[0].wasm_callback_object;
                                }
                                filters = [];
                                if (filters.length == 0) {
                                    res.send(JSON.stringify(joey_response));
                                }
                            });
                        }
                    }
                }
            } else {
                //console.log("No filters");
                var sqlSelect = "SELECT * from wasm_executables WHERE wasm_id = '" + req.params.wasm_id + "';";
                //console.log(sqlSelect);
                performSqlQuery(sqlSelect).then((result) => {
                    joey_response["wasm_id"] = result[0].wasm_id;
                    joey_response["wasm_sha256"] = "0x" + checksum.createHash('sha256').update(result[0].wasm_binary.toString()).digest('hex');
                    joey_response["wasm_description"] = result[0].wasm_description;
                    joey_response["wasm_as_buffer"] = result[0].wasm_binary;
                    joey_response["wasm_state"] = result[0].wasm_state;
                    joey_response["wasm_callback_object"] = result[0].wasm_callback_object;

                    res.send(JSON.stringify(joey_response));
                });
            }
        } else {
            joey_response["error"] = "wasm_id of " + req.params.wasm_id + " does not exist";
            res.send(JSON.stringify(joey_response));
        }

    });
});

// Get all Wasm executable
app.get('/api/executables', (req, res) => {
    var sqlSelectAllIds = "SELECT wasm_id from wasm_executables;";
    performSqlQuery(sqlSelectAllIds).then((result) => {
        res.send(JSON.stringify(result));
    });
});

app.put('/api/update_wasm_binary/:wasm_id', bodyParser.raw(), (req, res) => {
    joey_response = {};
    executableExists(req.params.wasm_id).then((result, error) => {
        //console.log("Result:" + result + ".");
        if (result == 1) {
            if (req.is('application/octet-stream') == 'application/octet-stream') {
                var wasm_as_buffer = Uint8Array.from(req.body);
                var sqlUpdate = "UPDATE wasm_executables SET wasm_binary = '" + wasm_as_buffer + "' WHERE wasm_id = '" + req.params.wasm_id + "';";
                //console.log(sqlUpdate);
                performSqlQuery(sqlUpdate).then((result) => {
                    joey_response["wasm_id"] = req.params.wasm_id;
                    joey_response["wasm_sha256"] = "0x" + checksum.createHash('sha256').update(wasm_as_buffer.toString()).digest('hex');
                    res.send(JSON.stringify(joey_response));
                });
            }
        } else {
            joey_response["error"] = "wasm_id of " + req.params.wasm_id + " does not exist";
            res.send(JSON.stringify(joey_response));
        }
    });
});

app.delete('/api/executables/:wasm_id', (req, res) => {
    joey_response = {};
    executableExists(req.params.wasm_id).then((result, error) => {
        //console.log("Result:" + result + ".");
        if (result == 1) {
            var sqlDelete = "DELETE from wasm_executables WHERE wasm_id = '" + req.params.wasm_id + "';";
            //console.log(sqlDelete);
            performSqlQuery(sqlDelete).then((result) => {
                joey_response["wasm_id"] = req.params.wasm_id
                res.send(JSON.stringify(joey_response));
            });
        } else {
            joey_response["error"] = "wasm_id of " + req.params.wasm_id + " does not exist";
            res.send(JSON.stringify(joey_response));
        }
    });
});
/* Running Wasm Functions */
//
// Run a function by calling with multi part form data
app.post('/api/multipart/run/:wasm_id/:function_name', (req, res, next) => {
    var joey_response = {};
    var array_of_parameters = [];
    // Perform logging
    if (log_level == 1) {
        var sqlSelect = "SELECT wasm_state FROM wasm_executables WHERE wasm_id = '" + req.params.wasm_id + "';";
        performSqlQuery(sqlSelect).then((stateResult) => {
            //console.log("Creating log object");
            var logging_object = {};
            logging_object["original_wasm_executables_id"] = req.params.wasm_id;
            logging_object["data_payload"] = req.body;
            var sqlInsert = "INSERT INTO wasm_execution_log (wasm_executable_id, wasm_executable_state, execution_timestamp, execution_object) VALUES ('" + req.params.wasm_id + "', '" + stateResult[0].wasm_state + "', NOW(), '" + JSON.stringify(logging_object) + "');";
            //console.log("sqlInsert: " + sqlInsert);
            performSqlQuery(sqlInsert).then((resultInsert) => {
                //console.log("Logging updated");
            });
        });
    }
    executableExists(req.params.wasm_id).then((result, error) => {
        //console.log("Result:" + result + ".");
        if (result == 1) {
            const form = formidable({
                multiples: true
            });
            var sqlSelect = "SELECT wasm_binary, wasm_state from wasm_executables WHERE wasm_id = '" + req.params.wasm_id + "';";
            performSqlQuery(sqlSelect).then((result2, error2) => {
                //console.log(result2[0].wasm_binary.data);
                //var wasm_state_as_string = result2[0].wasm_state;
                // wasm state will be implemented once ssvm supports wasi
                // var wasm_state_object = JSON.parse(result[0].wasm_state);
                // let vm = new ssvm.VM(uint8array, wasi_options);
                var uint8array = new Uint8Array(result2[0].wasm_binary.toString().split(','));
                var function_name = req.params.function_name;
                form.parse(req, (err, fields, files) => {
                    if (err) {
                        next(err);
                        joey_response["return_value"] = "Error reading multipart fields and/or files";
                        res.send(JSON.stringify(joey_response));
                        return;
                    }
                    // The formidable file and fields iteration is performed separately by formidable middleware, this is a mechanism to let us know when the iterator has completed the task (avoid race conditions)
                    var readyAtZero = new ReadyAtZero(Object.keys(files).length + Object.keys(fields).length);
                    parseMultipart(readyAtZero, files, fields, req).then((m_result, m_error) => {
                        if (!m_error) {
                            while (true) {
                                if (readyAtZero.isReady() == true) {
                                    //console.log("Ready with the following parts ...\n " + JSON.stringify(readyAtZero.container));
                                    var ordered_overarching_container = {};
                                    Object.keys(readyAtZero.container).sort().forEach(function(key) {
                                        ordered_overarching_container[key] = readyAtZero.container[key];
                                    });
                                    for (let [key, value] of Object.entries(ordered_overarching_container)) {
                                        array_of_parameters.push(`${value}`);
                                    }
                                    //console.log("Array of parameters for SSVM are as follows\n" + array_of_parameters);
                                    for (var i = 1; i <= array_of_parameters.length; i++) {
                                        console.log("\nParameter: " + i);
                                        console.log(array_of_parameters[i - 1]);
                                    }
                                    var vm = new ssvm.VM(uint8array);
                                    try {
                                        var return_value = vm.RunString(function_name, ...array_of_parameters);
                                    } catch (err) {
                                        joey_response["return_value"] = "Error executing this function, please check function name, input parameters, return parameter for correctness";
                                        res.send(JSON.stringify(joey_response));
                                    }
                                    joey_response["return_value"] = return_value;
                                    res.send(JSON.stringify(joey_response));
                                    break;
                                }
                            }
                        } else {
                            console.log(m_error);
                        }
                    });
                });
            });
        }
    });
});

// Run a function belonging to a Wasm executable -> returns a JSON string
app.post('/api/run/:wasm_id/:function_name', bodyParser.json(), (req, res) => {
    joey_response = {};
    if (req.is('application/json') == 'application/json') {
        isValidJSON(JSON.stringify(req.body)).then((result, error) => {
            if (result == true) {
                var process_callback = false;
                // Perform logging
                if (log_level == 1) {
                    var sqlSelect = "SELECT wasm_state FROM wasm_executables WHERE wasm_id = '" + req.params.wasm_id + "';";
                    performSqlQuery(sqlSelect).then((stateResult) => {
                        console.log("Creating log object");
                        var logging_object = {};
                        logging_object["original_wasm_executables_id"] = req.params.wasm_id;
                        logging_object["data_payload"] = req.body;
                        var sqlInsert = "INSERT INTO wasm_execution_log (wasm_executable_id, wasm_executable_state, execution_timestamp, execution_object) VALUES ('" + req.params.wasm_id + "', '" + JSON.stringify(stateResult[0].wasm_state) + "', NOW(), '" + JSON.stringify(logging_object) + "');";
                        performSqlQuery(sqlInsert).then((resultInsert) => {});
                    });
                }
                executableExists(req.params.wasm_id).then((result2, error) => {
                    if (result2 == 1) {
                        var sqlSelect = "SELECT wasm_binary, wasm_state from wasm_executables WHERE wasm_id = '" + req.params.wasm_id + "';";
                        performSqlQuery(sqlSelect).then((result3, error) => {
                            var function_name = req.params.function_name;
                            try {
                                var function_parameters = JSON.parse(JSON.stringify(req.body));
                            } catch (err) {
                                joey_response["error"] = err;
                                res.send(JSON.stringify(joey_response));
                            }
                            // Check for callback object
                            if (function_parameters.hasOwnProperty('SSVM_Callback')) {
                                process_callback = true;
                                console.log("Processing callback");
                                var callback_object_for_processing = function_parameters["SSVM_Callback"];
                                delete function_parameters.SSVM_Callback;
                                console.log("callback_object_for_processing: " + JSON.stringify(callback_object_for_processing));
                                console.log("function_parameters_as_string: " + JSON.stringify(function_parameters) + "\n\n");
                            }
                            var uint8array = new Uint8Array(result3[0].wasm_binary.toString().split(','));
                            var vm = new ssvm.VM(uint8array);
                            try {
                                var return_value = vm.RunString(function_name, JSON.stringify(function_parameters));
                            } catch (err) {
                                joey_response["return_value"] = "Error executing this function, please check function name, input parameters, return parameter for correctness";
                                res.send(JSON.stringify(joey_response));
                            }
                            try {
                                // If Joey is able to parse this response AND the response has a callback object, then Joey needs to perform the callback and give the response of the callback to the original caller
                                var return_value_as_object = JSON.parse(return_value);
                                if (process_callback == true) {
                                    // Add the return value to inside the callback object as the body
                                    callback_object_for_processing["body"] = return_value_as_object;
                                    //console.log("callback_object_for_processing: " + JSON.stringify(callback_object_for_processing));
                                    executeCallbackRequest(req.params.wasm_id, JSON.stringify(callback_object_for_processing)).then((result4, error) => {
                                        joey_response["return_value"] = result4;
                                        console.log(joey_response);
                                        res.send(JSON.stringify(joey_response));
                                    });
                                } else {
                                    // The response is valid JSON but there is no callback so we just need to return the response to the original caller verbatim
                                    joey_response["return_value"] = return_value_as_object;
                                    res.send(JSON.stringify(joey_response));
                                }
                            } catch {
                                // The response was obviously not valid JSON string so we just want to pass this string back to the original caller verbatim
                                joey_response["return_value"] = return_value
                                res.send(JSON.stringify(joey_response));
                            }
                        });
                    } else {
                        console.log("Error processing bytes for function: " + function_name + " for Wasm executable with wasm_id: " + req.params.wasm_id);
                        res.end();
                    }
                });
            } else {
                joey_response["error"] = "Not valid JSON";
                res.send(JSON.stringify(joey_response));
            }
        });
    } else {
        joey_response["error"] = "Mime type in request headers must be application/json";
        res.send(JSON.stringify(joey_response));
    }
});

// Run a function belonging to a Wasm executable -> returns a Buffer
// This endpoint calls vm.RunUint8Array which returns a Uint8Array,
// Each of these endpoints can only accept one type of data as the body i.e. the middleware can only parse raw OR json OR plain.,
// For this reason, this function will accept a Uint8Array from the caller (as the body). This makes the most sense because (sending receiving Uint8Array).
app.post('/api/run/:wasm_id/:function_name/bytes', bodyParser.raw(), (req, res) => {
    joey_response = {};
    // Logging
    if (log_level == 1) {
        var sqlSelect = "SELECT wasm_state FROM wasm_executables WHERE wasm_id = '" + req.params.wasm_id + "';";
        performSqlQuery(sqlSelect).then((stateResult) => {
            console.log("Creating log object");
            var logging_object = {};
            logging_object["original_wasm_executables_id"] = req.params.wasm_id;
            logging_object["data_payload"] = req.body;
            var sqlInsert = "INSERT INTO wasm_execution_log (wasm_executable_id, wasm_executable_state, execution_timestamp, execution_object) VALUES ('" + req.params.wasm_id + "', '" + stateResult[0].wasm_state + "', NOW(), '" + JSON.stringify(logging_object) + "');";
            //console.log("sqlInsert: " + sqlInsert);
            performSqlQuery(sqlInsert).then((resultInsert) => {

            });
        });
    }
    var start = new Date();
    var hrstart = process.hrtime();
    console.log("Logging updated");
    executableExists(req.params.wasm_id).then((result, error) => {
        if (result == 1) {
            console.log("Checking content type ...");
            // Setting response type
            res.set('Content-Type', 'application/octet-stream')
            if (req.is('application/octet-stream') == 'application/octet-stream') {
                var sqlSelect = "SELECT wasm_binary, wasm_state from wasm_executables WHERE wasm_id = '" + req.params.wasm_id + "';";
                performSqlQuery(sqlSelect).then((result2, error) => {
                    var array = result2[0].wasm_binary.toString().split(",");
                    let vm = new ssvm.VM(Uint8Array.from(array));
                    var function_name = req.params.function_name;
                    var body_as_buffer = Uint8Array.from(req.body);
                    try {
                        var return_value = vm.RunUint8Array(function_name, body_as_buffer);
                    } catch (err) {
                        joey_response["return_value"] = "Error executing this function, please check function name, input parameters, return parameter for correctness";
                        res.send(JSON.stringify(joey_response));
                    }
                    var end = new Date() - start,
                        hrend = process.hrtime(hrstart);
                    console.info('Whole process completed in: %dms', hrend[1] / 1000000);
                    res.send(Buffer.from(return_value));
                });
            } else {
                console.log("Error processing bytes for function: " + req.params.function_name + " for Wasm executable with wasm_id: " + req.params.wasm_id);
                res.end();
            }
        } else {
            joey_response["error"] = "wasm_id of " + req.params.wasm_id + " does not exist";
            res.send(JSON.stringify(joey_response));
        }
    });
});

app.put('/api/state/:wasm_id', bodyParser.text(), (req, res) => {
    console.log("Request to update state into the database ...");
    //console.log(req.body);
    executableExists(req.params.wasm_id).then((result, error) => {
        if (result == 1) {
            if (req.is('text/plain') == 'text/plain') {
                var sqlInsert = "UPDATE wasm_executables SET wasm_state = '" + req.body + "' WHERE wasm_id = '" + req.params.wasm_id + "';";
                performSqlQuery(sqlInsert).then((resultInsert) => {
                    res.send(req.params.wasm_id);
                });
            }
        } else {
            res.send(req.params.wasm_id + " does not exist");
        }
    });
});

app.put('/api/callback/:wasm_id', bodyParser.json(), (req, res) => {
    joey_response = {};
    console.log("Request to update callback object in the database ...");
    isValidJSON(JSON.stringify(req.body)).then((result, error) => {
        if (result == true) {
            executableExists(req.params.wasm_id).then((result2, error) => {
                if (result2 == 1) {
                    var sqlInsert = "UPDATE wasm_executables SET wasm_callback_object = '" + JSON.parse(JSON.stringify(req.body)) + "' WHERE wasm_id = '" + req.params.wasm_id + "';";
                    performSqlQuery(sqlInsert).then((resultInsert) => {
                        res.send(req.params.wasm_id);
                    });

                } else {
                    joey_response["error"] = req.params.wasm_id + " does not exist";
                    res.send(JSON.stringify(joey_response));
                }

            });

        } else {
            joey_response["error"] = "Not valid JSON";
            res.send(JSON.stringify(joey_response));
        }
    });
});

// Get a set of records in relation to execution of callbacks for a particular wasm_id
app.get('/api/log/:wasm_id', (req, res) => {
    joey_response = {};
    executionLogExists(req.params.wasm_id).then((result, error) => {
        if (result >= 1) {
            var valid_filters = ["log_id", "wasm_executable_id", "wasm_executable_state", "execution_timestamp", "execution_object"];
            var request_validity = true;
            if (req.query.filterBy != undefined) {
                try {
                    var filters = JSON.parse(req.query.filterBy);
                } catch {
                    joey_response["error"] = "Please check your filterBy parameters. Not valid string array!";
                    res.send(JSON.stringify(joey_response));
                    res.end();
                }
                if (filters.length >= 1) {
                    for (var i = 0; i < filters.length; i++) {
                        if (!valid_filters.includes(filters[i])) {
                            console.log(filters[i] + " is NOT a valid filter ...");
                            request_validity = false;
                        } else {
                            console.log(filters[i] + " is a valid filter ...");
                        }
                    }
                    if (request_validity == false) {
                        res.send(JSON.stringify([{
                            "error_invalid_filter": JSON.stringify(filters)
                        }, {
                            "valid_filters_include": valid_filters
                        }]));
                    } else {
                        // We need to perform separate select query for complex objects (LONGBLOB & LONGTEXT etc.)
                        if (filters.length >= 1) {
                            if (filters.includes("wasm_executable_state")) {
                                filters = removeElementFromArray(filters, "wasm_executable_state");
                                var sqlSelect = "SELECT wasm_executable_state from wasm_execution_log WHERE wasm_executable_id = '" + req.params.wasm_id + "';";
                                //console.log(sqlSelect);
                                performSqlQuery(sqlSelect).then((result2) => {
                                    joey_response["wasm_executable_state"] = result2[0].wasm_executable_state;
                                    if (filters.length == 0) {
                                        res.send(JSON.stringify(joey_response));
                                    }
                                });
                            }
                        }
                        // We need to perform separate select query for complex objects (LONGBLOB & LONGTEXT etc.)
                        if (filters.length >= 1) {
                            if (filters.includes("execution_object")) {
                                filters = removeElementFromArray(filters, "execution_object");
                                var sqlSelect = "SELECT execution_object from wasm_execution_log WHERE wasm_executable_id = '" + req.params.wasm_id + "';";
                                //console.log(sqlSelect);
                                performSqlQuery(sqlSelect).then((result3) => {
                                    joey_response["execution_object"] = result3[0].execution_object;
                                    if (filters.length == 0) {
                                        res.send(JSON.stringify(joey_response));
                                    }
                                });
                            }
                        }
                        if (filters.length >= 1) {
                            var sqlSelect = "SELECT " + filters.join() + " from wasm_execution_log WHERE wasm_executable_id = '" + req.params.wasm_id + "';";
                            //console.log("SQL with filters.join()\n" + sqlSelect);
                            performSqlQuery(sqlSelect).then((result4) => {
                                if (filters.includes("log_id")) {
                                    joey_response["log_id"] = result4[0].log_id;
                                }
                                if (filters.includes("wasm_executable_id")) {
                                    joey_response["wasm_executable_id"] = result4[0].wasm_executable_id;
                                }
                                if (filters.includes("execution_timestamp")) {
                                    joey_response["execution_timestamp"] = result4[0].execution_timestamp;
                                }
                                filters = [];
                                if (filters.length == 0) {
                                    res.send(JSON.stringify(joey_response));
                                }
                            });
                        }
                    }
                }
            } else {
                console.log("No filters");
                var sqlSelect = "SELECT * from wasm_execution_log WHERE wasm_executable_id = '" + req.params.wasm_id + "';";
                //console.log(sqlSelect);
                performSqlQuery(sqlSelect).then((result5) => {
                    joey_response["log_id"] = result5[0].log_id;
                    joey_response["wasm_executable_id"] = result5[0].wasm_executable_id;
                    joey_response["wasm_executable_state"] = result5[0].wasm_executable_state;
                    joey_response["execution_timestamp"] = result5[0].execution_timestamp;
                    joey_response["execution_object"] = result5[0].execution_object;
                    res.send(JSON.stringify(joey_response));
                });
            }
        } else {
            joey_response["error"] = "wasm_id of " + req.params.wasm_id + " does not exist";
            res.send(JSON.stringify(joey_response));
        }

    });
});