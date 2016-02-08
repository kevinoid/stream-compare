#!/usr/bin/env node
/**
 * NPM preversion script for doing checks before the package version is changed.
 *
 * @copyright Copyright 2016 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */
'use strict';

var preversion = {};

var assert = require('assert');
var childProcess = require('child_process');
var debug = require('debug')('preversion');
var pify = require('pify');
var request = require('request');
var which = require('which');

var execFileP = pify(childProcess.execFile, {multiArgs: true});
var requestP = pify(request, {multiArgs: true});
var whichP = pify(which);

/** Length of abbreviated hashes to print. */
var ABBREV_HASH_LEN = 8;
/** Branch from which releases are made. */
var RELEASE_BRANCH = 'master';
/** Project repository name used for Travis CI. */
var TRAVIS_REPO_NAME = 'kevinoid/stream-compare';

/** Executes a file then returns its output from stdout (trimmed). */
function execFileOut(/* args */) {
  return execFileP.apply(this, arguments)
    .then(function getStdout(result) {
      return result[0].trimRight();
    });
}

/** Checks that the Travis CI build for a given branch passed and that it
 * has a given commit hash.
 *
 * @param {string} repoName Name of the repository in Travis CI.
 * @param {string} branchName Name of the branch to check.
 * @param {string} commitHash Hash of the commit against which to compare.
 * @return {Promise} A Promise which is rejected if the build for branchName
 * did not pass or if its commit did not match commitHash.
 */
preversion.checkTravis = function checkTravis(repoName, branchName,
    commitHash) {
  // Note:  Not escaping repository name, since Travis doesn't
  var url = 'https://api.travis-ci.org/repos/' + repoName + '/branches/' +
              encodeURIComponent(branchName);
  debug('Checking Travis CI status of %s branch of %s using %s', branchName,
      repoName, url);
  return requestP({
    url: url,
    gzip: true,
    strictSSL: true,
    headers: {
      Accept: 'application/vnd.travis-ci.2+json'
    }
  })
    .then(function(responseAndBody) {
      var response = responseAndBody[0];
      var body = responseAndBody[1];

      assert.strictEqual(
          response.statusCode,
          200,
          'Travis CI API returned ' + response.statusCode + ' ' +
            response.statusMessage
      );

      var jsonTypeRE = /^application\/json(\s*;.*)$|\+json$/i;
      var contentType = response.headers['content-type'];
      assert(
          jsonTypeRE.test(contentType),
          'Travis CI API returned ' + contentType + '. Expected JSON.'
      );

      return JSON.parse(body);
    })
    .then(function(result) {
      assert.strictEqual(
          result.commit.sha,
          commitHash,
          'Current build for branchName ' + branchName +
            ' is for commit ' + result.commit.sha.slice(0, ABBREV_HASH_LEN) +
            ' not ' + commitHash.slice(0, ABBREV_HASH_LEN)
      );
      assert.strictEqual(
          result.branch.state,
          'passed',
          'Current build for branch ' + branchName + ' (' +
            result.commit.sha.slice(0, ABBREV_HASH_LEN) + ') has state "' +
          result.branch.state + '".  Can\'t release until "passed".'
      );
    });
};

/** Checks that the current git repository has no modified files, is on the
 * master branch, and is up-to-date with origin.
 */
preversion.checkGit = function checkGit(gitPath) {
  /** Gets the current git branch name and checks that it is "master". */
  function checkCurrentBranch() {
    debug('Checking current git branch is %s...', RELEASE_BRANCH);
    return execFileOut(gitPath, ['symbolic-ref', '--short', 'HEAD'])
      .then(function(branchName) {
        assert.deepEqual(
            branchName,
            RELEASE_BRANCH,
            'Must release from ' + RELEASE_BRANCH + ' branch.'
        );
        return branchName;
      });
  }

  function getBranchConfig(branchName, configName) {
    return execFileOut(
        gitPath,
        ['config', '--get', 'branch.' + branchName + '.' + configName]
    );
  }

  function fetchRemoteFor(branchName) {
    return getBranchConfig(branchName, 'remote')
      .then(function fetchRemote(remoteName) {
        return execFileP(gitPath, ['fetch', '-q', remoteName])
          // Return the name of the remote fetched
          .then(function() { return remoteName; });
      });
  }

  function compareHistory(commit1, commit2) {
    var commits = commit1 + '...' + commit2;
    return execFileOut(
        gitPath,
        ['rev-list', '--left-right', '--pretty=oneline', commits]
    );
  }

  function checkBranchIsUpToDate(branchName) {
    debug('Checking current git branch is up-to-date with remote...');
    // Could do ls-remote to be less intrusive, but the user will want to
    // compare and pull/push anyway, so just fetch it.
    return Promise.all([
      fetchRemoteFor(branchName),
      getBranchConfig(branchName, 'merge')
        .then(function(mergeRef) {
          return mergeRef.replace(/^refs\/heads\//, '');
        })
    ])
      .then(function(results) {
        var remoteName = results[0];
        var remoteBranch = results[1];
        var remoteBranchQName = remoteName + '/' + remoteBranch;

        return compareHistory(branchName, remoteBranchQName)
          .then(function(commitHistory) {
            assert.deepEqual(
                commitHistory,
                '',
                'Branch is not up to date with ' + remoteBranchQName +
                  ':\n' + commitHistory
            );
            return branchName;
          });
      });
  }

  /** Gets the git status and checks that it is empty. */
  function checkStatus() {
    debug('Checking that there are no uncommitted changes...');
    return execFileOut(
        gitPath,
        ['status', '--porcelain', '--untracked-files=no']
    )
      .then(function assertStatus(gitStatus) {
        assert.deepEqual(gitStatus, '', 'Must have no uncommitted changes.');
        return gitStatus;
      });
  }

  function getHash(refName) {
    return execFileOut(gitPath, ['rev-parse', '--verify', refName]);
  }

  // Run local read-only commands first, for performance
  return Promise.all([
    checkStatus(),
    checkCurrentBranch()
      .then(checkBranchIsUpToDate),
    getHash('HEAD')
  ])
    .then(function(results) {
      return {
        branchName: results[1],
        commitHash: results[2]
      };
    });
};

preversion.main = function main(args) {
  return whichP('git')
    .then(preversion.checkGit)
    .then(function(gitInfo) {
      return preversion.checkTravis(
          TRAVIS_REPO_NAME,
          gitInfo.branchName,
          gitInfo.commitHash
      );
    });
};

module.exports = preversion;

if (require.main === module) {
  // This file was invoked directly.
  preversion.main(process.argv).catch(function(err) {
    if (err.stderr) {
      process.stderr.write(err.stderr);
    }
    process.stderr.write(err.name + ': ' + err.message + '\n');
    process.exit(typeof err.code === 'number' ? err.code : 1);
  });
}
