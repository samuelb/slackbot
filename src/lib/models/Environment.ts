import moment = require('moment-timezone');
import { AppName, Application, IApplication } from './Application';
import { Maybe } from './Maybe';
import { IFromatParams, Format } from '../Format';

export type EnvName = 'ALL'
    | 'ET'
    | 'UT'
    | 'QT'
    | 'PT'
    | 'PROD'
    | 'DE'
    | 'CN'
    | 'EU'
    | 'US'
    | 'PROD-QA-EU'
    | 'PROD-QA-US'
    | 'SANDBOX'
    | 'NIGHTLY'
    | 'BETA'
    | 'STORE'

export type EnvFilter = (env: Environment) => boolean;

export interface IRequestOptions {
    url: string;
    headers?: Maybe<{ [h: string]: string }>
}

export interface IEnvResponse extends IFromatParams {
    resultLine: string;
    hasError: boolean;
}

export type httpMiddleWare = (opt: Maybe<IRequestOptions>) => Promise<string>;

export interface IEnvironment {
    env: [EnvName, string, Maybe<{ [h: string]: string }>];
    app: IApplication
}

export class Environment implements IEnvironment {
    constructor(public env: [EnvName, string, Maybe<{ [h: string]: string }>], public app: Application) {
    }

    public getStatus(get: httpMiddleWare, format: Format): Promise<IEnvResponse> {
        switch (this.app.type) {
            case 'WEBAPP':
                return this.fromWebapp(get, format);
            case 'FACADE':
                return this.fromFacade(get, format);
            case 'CLOUD':
                return this.fromCloud(get, format);
            case 'ANDROID':
                return this.fromHockeyApp(get, format);
            default:
                return Promise.reject(new Error(`appType:${this.app.type} has no mapper`));
        }
    }

    private fromWebapp(get: httpMiddleWare, format: Format): Promise<IEnvResponse> {
        const { appShortName, githubRepoUrl } = this.app;
        const versionInfo = this.app.getVersionInfo(this.env)
        const deploymentInfo = this.app.getDeploymentInfo(this.env);
        return Promise
            .all([
                get(versionInfo)
                    .then(it => JSON.parse(it) as { lastCommit: string; buildTimestamp: string; appConfig: { version: string; } }),
                (deploymentInfo
                    ? get(deploymentInfo).then(it => JSON.parse(it))
                        .catch(error => ({ timestamp: null })) // catch 404, and redirects on deploy file.
                    : Promise.resolve(({ timestamp: null }))) as Promise<{ timestamp: null | string }>
            ])
            .then(([{ lastCommit, buildTimestamp, appConfig }, { timestamp }]) => format.mixinResultLine({
                env: this.env,
                appShortName,
                githubRepoUrl,
                lastCommit,
                buildTimestamp,
                version: appConfig.version,
                deployedTimestamp: timestamp,
                lastModifiedTimestamp: null, // headers["last-modified"],
                diffingHash: `${appShortName}-${appConfig.version}-${lastCommit}`
            }));
    }

    private fromCloud(get: httpMiddleWare, format: Format) {
        const { appShortName, githubRepoUrl } = this.app;
        const versionInfo = this.app.getVersionInfo(this.env);
        return get(versionInfo)
            .then(rawBody => {

                let version = null as null | string;
                const exp = new RegExp(/([0-9][0-9]?\.[0-9][0-9]?\.[0-9][0-9]?\.[0-9][0-9]?[0-9]?)/);
                if (exp.test(rawBody)) {
                    const matches = exp.exec(rawBody);
                    version = matches && matches[0] ? matches[0] : version;
                }


                let buildTimestamp = null as null | moment.Moment;
                if (version) {
                    buildTimestamp = moment(
                        rawBody
                            .toLowerCase()
                            .replace(`${appShortName}-${version}`.toLowerCase(), '')
                            .replace('(', '')
                            .replace(')', '')
                            .toUpperCase(),
                        moment.ISO_8601)
                        .utc();
                }

                return format.mixinResultLine({
                    env: this.env,
                    appShortName,
                    githubRepoUrl,
                    version,
                    lastCommit: null,
                    buildTimestamp: buildTimestamp,
                    deployedTimestamp: null,
                    lastModifiedTimestamp: null,
                    diffingHash:`${appShortName}-${rawBody}`
                });
            });
    }

    private fromFacade(get: httpMiddleWare, format: Format) {
        const { appShortName, githubRepoUrl } = this.app;
        const versionInfo = this.app.getVersionInfo(this.env)
        const deploymentInfo = this.app.getDeploymentInfo(this.env);
        return get(versionInfo)
            .then(rawBody => JSON.parse(rawBody) as { lastCommit: string; buildTimestamp: string; deployTimestamp: string, version: string })
            .then(({ lastCommit, version, buildTimestamp, deployTimestamp }) => format.mixinResultLine({
                env: this.env,
                appShortName,
                githubRepoUrl,
                version,
                lastCommit,
                buildTimestamp,
                deployedTimestamp: deployTimestamp,
                lastModifiedTimestamp: null,
                diffingHash: `${appShortName}-${version}-${lastCommit}`
            }));
    }

    private fromHockeyApp(get: httpMiddleWare, format: Format) {
        const { appShortName, githubRepoUrl } = this.app;
        const versionInfo = this.app.getVersionInfo(this.env)
        return get(versionInfo)
            .then(rawBody => {

                const [it] = (JSON.parse(rawBody) as {
                    app_versions: {
                        download_url: string;
                        shortversion: string;
                        updated_at: string;
                        notes: string;
                    }[], status: 'success'
                }).app_versions;

                let lastCommit = null as Maybe<string>;

                const exp = new RegExp(/\b([a-f0-9]{40})\b/);
                if (exp.test(it.notes)) {
                    const matches = exp.exec(it.notes);
                    lastCommit = matches && matches[0] ? matches[0] : lastCommit;
                }

                return format.mixinResultLine({
                    env: this.env,
                    appShortName,
                    lastCommit,
                    githubRepoUrl,
                    version: it.shortversion,
                    buildTimestamp: null,
                    deployedTimestamp: it.updated_at,
                    lastModifiedTimestamp: null,
                    diffingHash: `${appShortName}-${it.shortversion}-${lastCommit ? lastCommit : ''}`
                });
            });
    }

}
