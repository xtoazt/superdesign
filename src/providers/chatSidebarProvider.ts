import * as vscode from 'vscode';
import { ClaudeCodeService } from '../services/claudeCodeService';
import { ChatMessageService } from '../services/chatMessageService';
import { generateWebviewHtml } from '../templates/webviewTemplate';
import { WebviewContext } from '../types/context';
import { AgentService } from '../types/agent';

export class ChatSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly VIEW_TYPE = 'superdesign.chatView';
    private _view?: vscode.WebviewView;
    private messageHandler: ChatMessageService;
    private customMessageHandler?: (message: any) => void;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly agentService: AgentService,
        private readonly outputChannel: vscode.OutputChannel
    ) {
        this.messageHandler = new ChatMessageService(agentService, outputChannel);
    }

    public setMessageHandler(handler: (message: any) => void) {
        this.customMessageHandler = handler;
    }

    public sendMessage(message: any) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'dist'),
                vscode.Uri.joinPath(this._extensionUri, 'src', 'assets')
            ]
        };

        const webviewContext: WebviewContext = {
            layout: 'sidebar',
            extensionUri: this._extensionUri.toString()
        };

        webviewView.webview.html = generateWebviewHtml(
            webviewView.webview,
            this._extensionUri,
            webviewContext
        );

        webviewView.webview.onDidReceiveMessage(
            async (message) => {
                if (this.customMessageHandler) {
                    this.customMessageHandler(message);
                }

                switch (message.command) {
                    case 'chatMessage':
                        await this.messageHandler.handleChatMessage(message, webviewView.webview);
                        break;
                    case 'stopChat':
                        await this.messageHandler.stopCurrentChat(webviewView.webview);
                        break;
                    case 'executeAction':
                        if (message.actionArgs) {
                            await vscode.commands.executeCommand(message.actionCommand, message.actionArgs);
                        } else {
                            await vscode.commands.executeCommand(message.actionCommand);
                        }
                        break;
                    case 'getBase64Image':
                        break;
                    case 'getCurrentProvider':
                        await this.handleGetCurrentProvider(webviewView.webview);
                        break;
                    case 'changeProvider':
                        await this.handleChangeProvider(message.model, webviewView.webview);
                        break;
                }
            }
        );
    }

    private async handleGetCurrentProvider(webview: vscode.Webview) {
        const config = vscode.workspace.getConfiguration('superdesign');
        const currentProvider = config.get<string>('aiModelProvider', 'anthropic');
        const currentModel = config.get<string>('aiModel');

        let defaultModel: string;
        switch (currentProvider) {
            case 'openai':
                defaultModel = 'gpt-4o';
                break;
            case 'openrouter':
                defaultModel = 'anthropic/claude-3-7-sonnet-20250219';
                break;
            case 'groq':
                defaultModel = 'llama3-70b-8192'; // 👈 Groq default
                break;
            case 'anthropic':
            default:
                defaultModel = 'claude-3-5-sonnet-20241022';
                break;
        }

        webview.postMessage({
            command: 'currentProviderResponse',
            provider: currentProvider,
            model: currentModel || defaultModel
        });
    }

    private async handleChangeProvider(model: string, webview: vscode.Webview) {
        try {
            const config = vscode.workspace.getConfiguration('superdesign');

            let provider: string;
            let apiKeyKey: string;
            let configureCommand: string;
            let displayName: string;

            if (model.includes('/')) {
                provider = 'openrouter';
                apiKeyKey = 'openrouterApiKey';
                configureCommand = 'superdesign.configureOpenRouterApiKey';
                displayName = `OpenRouter (${this.getModelDisplayName(model)})`;
            } else if (model.startsWith('claude-')) {
                provider = 'anthropic';
                apiKeyKey = 'anthropicApiKey';
                configureCommand = 'superdesign.configureApiKey';
                displayName = `Anthropic (${this.getModelDisplayName(model)})`;
            } else if (model.startsWith('llama') || model.startsWith('mixtral')) {
                provider = 'groq'; // 👈 added Groq
                apiKeyKey = 'groqApiKey';
                configureCommand = 'superdesign.configureGroqApiKey';
                displayName = `Groq (${this.getModelDisplayName(model)})`;
            } else {
                provider = 'openai';
                apiKeyKey = 'openaiApiKey';
                configureCommand = 'superdesign.configureOpenAIApiKey';
                displayName = `OpenAI (${this.getModelDisplayName(model)})`;
            }

            await config.update('aiModelProvider', provider, vscode.ConfigurationTarget.Global);
            await config.update('aiModel', model, vscode.ConfigurationTarget.Global);

            const apiKey = config.get<string>(apiKeyKey);

            if (!apiKey) {
                const result = await vscode.window.showWarningMessage(
                    `${displayName} selected, but API key is not configured. Would you like to configure it now?`,
                    'Configure API Key',
                    'Later'
                );

                if (result === 'Configure API Key') {
                    await vscode.commands.executeCommand(configureCommand);
                }
            }

            webview.postMessage({
                command: 'providerChanged',
                provider: provider,
                model: model
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to update AI model: ${error}`);
        }
    }

    private getModelDisplayName(model: string): string {
        const modelNames: { [key: string]: string } = {
            // existing…

            // 👇 Groq models
            'llama3-70b-8192': 'Llama 3 70B (Groq)',
            'llama3-8b-8192': 'Llama 3 8B (Groq)',
            'mixtral-8x7b-32768': 'Mixtral 8x7B (Groq)'
        };

        return modelNames[model] || model;
    }
}
