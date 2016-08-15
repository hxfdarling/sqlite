//Requeries
var sqlite3 = require('sqlite3');
var fs = require('fs');
var crypto = require('crypto');

function Sqlite() {

}
//Variables
Sqlite.prototype.db = null;
Sqlite.prototype.file = null;
Sqlite.prototype.sql = '';
Sqlite.prototype.debug = false;
Sqlite.prototype.algorithms = crypto.getCiphers();

/**
 * Buffer decryption
 */
Sqlite.prototype.decrypt = function() {
	var me = this;
	//如果解密文件存在则不进行解密
	//这种情况可能由于程序异常退出，没有完成加密
	if (fs.existsSync(me.decryptedFile)) {
		return;
	}
	if (fs.existsSync(me.file)) {
		var decipher = crypto.createDecipher(me.algorithm, me.password);
		fs.writeFileSync(me.decryptedFile, Buffer.concat([decipher.update(fs.readFileSync(me.file)), decipher.final()]));
	}
};
/**
 * Buffer encryption
 */
Sqlite.prototype.encrypt = function() {
	var me = this;
	if (fs.existsSync(me.decryptedFile)) {
		var cipher = crypto.createCipher(me.algorithm, me.password);
		fs.writeFileSync(me.file, Buffer.concat([cipher.update(fs.readFileSync(me.decryptedFile)), cipher.final()]));
		fs.unlinkSync(me.decryptedFile);
	}
};
/**
 * Database open
 *
 * @param {String|Object} file - File directory+filename
 * @return {Object}
 */
Sqlite.prototype.open = function(file, password, algorithm) {
	var me = this;
	me.file = file;
	me.password = password;
	me.algorithm = algorithm || 'aes-256-ctr';
	me.needEncrypt = (typeof password !== 'undefined');
	if (me.needEncrypt) {
		if (me.algorithms.indexOf(me.algorithm) == -1) {
			throw "This algorithm is not supported";
		}
		me.decryptedFile = decryptedFile = me.file + '.tmp';
		//解密数据库文件
		me.decrypt();
	}

	//打开数据库
	return me.promise = new Promise(function(resolve, reject) {
		me.db = new sqlite3.Database(me.needEncrypt ? me.decryptedFile : me.file, function(error) {
			if (error) {
				reject(error);
			} else {
				resolve(me.db);
			}
		})
	}).then(function() {
		return me.test();
	});
};
//测试数据库文件是否打开成功
Sqlite.prototype.test = function() {
	var me = this;
	return new Promise(function(resolve, reject) {
		me.run('create table test_encrypt(id TEXT);')
			.then(function() {
				return me.run('drop table test_encrypt;');
			})
			.then(function() {
				resolve();
			})
			.catch(function(error) {
				try { //失败后删除文件
					me.db.close(function() {
						fs.unlinkSync(me.decryptedFile);
						reject(error);
					});
				} catch (e) {
					reject(error);
				}
			});
	});
};
//关闭数据库
Sqlite.prototype.close = function() {
	var me = this;
	return new Promise(function(resolve, reject) {
			me.db.close(function(error) {
				if (error) {
					reject(error);
				} else {
					resolve();
				}
			});
		})
		.then(function() {
			if (me.needEncrypt) {
				//关闭后加密数据库文件
				return new Promise(function(resolve, reject) {
					me.encrypt();
					resolve();
				});
			}
		});
};

Sqlite.prototype.serialize = function() {
	// return this.promise = this.promise.catch(function() {
	//    return new Promise(function(resolve) {
	//       resolve();
	//    });
	// });
	return new Promise(function(resolve) {
		resolve();
	});
};

/**
 * Runing queries | Sync & Async
 *
 * @param {String} sql - SQL code
 * @param {Array|Function} options - Array to prepared sql | callback function
 * @param {Function} callback - callback function
 * @return {Array|Object}
 */
Sqlite.prototype.run = function(sql, options) {
	var promise;
	var me = this;
	var type = sql.substring(0, 6);
	type = type.toUpperCase();
	switch (type) {
		case "SELECT":
			promise = me.pvSELECT(sql, options);
			break;
		case "INSERT":
			promise = this.promise = me.serialize().then(function() {
				return me.pvINSERT(sql, options);
			});
			break;
		case "UPDATE":
			promise = this.promise = me.serialize().then(function() {
				return me.pvUPDATE(sql, options);
			});
			break;
		case "DELETE":
			promise = this.promise = me.serialize().then(function() {
				return me.pvDELETE(sql, options);
			});
			break;
		case 'PRAGMA':
			promise = me.pvPRAGMA(sql);
			break;
		default:
			promise = me.promise = me.serialize().then(function() {
				return me.runAll(sql)
			});
	}
	if (me.debug) {
		promise.then(function(result) {
			console.log(me.replaceWhere(sql, options));
			console.log(result);
		}).catch(function(error) {
			console.log(me.replaceWhere(sql, options));
			console.log(error);
		});
	}
	return promise;
};
/**
 * 修复sql?号替换异常
 * @param  {[type]} sql   [description]
 * @param  {[type]} where [description]
 * @return {[type]}       [description]
 */
Sqlite.prototype.replaceWhere = function(sql, where) {
	var w = '';
	if (where) {
		var sqls = sql.split('?');
		var sql = '';
		for (var i = 0; i < sqls.length - 1; i++) {
			sql += sqls[i];
			switch (typeof where[i]) {
				case 'number':
					w = where[i];
					break;
				case 'undefined':
					w = '?';
					break;
				default:
					w = ("\'" + where[i] + "\'");
			}
			sql += w;
		}
		sql += sqls[sqls.length - 1];
	}
	return sql;
};
/**
 * Runing selects - PRIVATE
 *
 * @param {String}  sql - SQL code
 * @param {Array} where - Array to prepared sql
 * @return {Object}
 */
Sqlite.prototype.pvSELECT = function(sql, where) {
	this.sql = this.replaceWhere(sql, where);
	var me = this;
	return new Promise(function(resolve, reject) {
		where = where || [];
		me.db.all(sql, where, function(error, results) {
			if (error) {
				reject(error);
			} else {
				resolve(results);
			}
		});
	});

};

/**
 * Runing deletes - PRIVATE
 *
 * @param {String}  sql - SQL code
 * @param {Array} where - Array to prepared sql
 * @return {Boo}
 */
Sqlite.prototype.pvDELETE = function(sql, where) {
	this.sql = this.replaceWhere(sql, where);
	var me = this;
	return new Promise(function(resolve, reject) {
		where = where || [];
		me.db.run(sql, where, function(error, results) {
			if (error) {
				reject(error);
			} else {
				resolve(results);
			}
		});
	});
};

/**
 * Runing insets - PRIVATE
 *
 * @param {String}  sql - SQL code
 * @param {Array} where - Array to prepared sql
 * @return {Int} last insert id
 */
Sqlite.prototype.pvINSERT = function(sql, where) {
	this.sql = this.replaceWhere(sql, where);
	var me = this;
	return new Promise(function(resolve, reject) {
		where = where || [];
		me.db.run(sql, where, function(error, results) {
			if (error) {
				reject(error);
			} else {
				resolve(results);
			}
		});
	});

};

/**
 * Runing updates - PRIVATE
 *
 * @param {String}  sql - SQL code
 * @param {Array} where - Array to prepared sql
 * @return {Boo}
 */
Sqlite.prototype.pvUPDATE = function(sql, where) {
	this.sql = this.replaceWhere(sql, where);
	var me = this;

	return new Promise(function(resolve, reject) {
		where = where || [];
		me.db.run(sql, where, function(error, results) {
			if (error) {
				reject(error);
			} else {
				resolve(results);
			}
		});
	});

};
Sqlite.prototype.pvPRAGMA = function(sql) {
	var me = this;
	this.sql = sql;
	return new Promise(function(resolve, reject) {
		me.db.exec(sql, function(error, results) {
			if (error) {
				reject(error);
			} else {
				resolve(results);
			}
		});
	});
};
Sqlite.prototype.runAll = function(sql, where) {
	var me = this;
	this.sql = this.replaceWhere(sql, where);
	return new Promise(function(resolve, reject) {
		where = where || [];
		me.db.run(sql, where, function(error, results) {
			if (error) {
				reject(error);
			} else {
				resolve(results);
			}
		});
	});

};

/**
 * Get current sql
 * @return {String}
 */
Sqlite.prototype.getSql = function() {
	return this.sql;
};

// Exporting module
module.exports = new Sqlite();