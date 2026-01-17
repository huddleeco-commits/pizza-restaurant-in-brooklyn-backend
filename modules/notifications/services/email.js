// services/email.service.js
// Complete Email Service with Welcome Template and All Features

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

class EmailNotificationService {
    constructor() {
        this.transporter = null;
        this.initialized = false;
        this.emailQueue = [];
        this.processing = false;
        this.templates = {};
        
        this.initialize();
        this.loadTemplates();
    }
    
    initialize() {
        try {
            // Configure email transporter based on service
            const emailService = process.env.EMAIL_SERVICE || 'gmail';
            
            if (emailService === 'sendgrid') {
                // SendGrid configuration
                const sgMail = require('@sendgrid/mail');
                sgMail.setApiKey(process.env.SENDGRID_API_KEY);
                this.transporter = sgMail;
                this.useSendGrid = true;
            } else {
                // Nodemailer configuration (Gmail, SMTP, etc.)
                this.transporter = nodemailer.createTransport({
                    service: emailService,
                    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
                    port: process.env.EMAIL_PORT || 587,
                    secure: process.env.EMAIL_SECURE === 'true',
                    auth: {
                        user: process.env.EMAIL_USER,
                        pass: process.env.EMAIL_PASS
                    }
                });
                this.useSendGrid = false;
            }
            
            this.initialized = true;
            console.log(`📧 Email service initialized with ${emailService}`);
            
            // Start processing queue
            this.startQueueProcessor();
            
        } catch (error) {
            console.error('❌ Email service initialization failed:', error);
            this.initialized = false;
        }
    }
    
    loadTemplates() {
        try {
            const templatesDir = path.join(__dirname, '../templates');
            
            // Check if templates directory exists
            if (fs.existsSync(templatesDir)) {
                const templateFiles = fs.readdirSync(templatesDir);
                
                templateFiles.forEach(file => {
                    if (file.endsWith('.html')) {
                        const templateName = file.replace('.html', '');
                        const templatePath = path.join(templatesDir, file);
                        this.templates[templateName] = fs.readFileSync(templatePath, 'utf8');
                        console.log(`📄 Loaded email template: ${templateName}`);
                    }
                });
            } else {
                console.log('📁 Templates directory not found, using inline templates');
            }
        } catch (error) {
            console.log('⚠️ Could not load template files, using inline templates');
        }
    }
    
    // Queue processor
    startQueueProcessor() {
        setInterval(async () => {
            if (!this.processing && this.emailQueue.length > 0) {
                this.processing = true;
                const email = this.emailQueue.shift();
                
                try {
                    await this.sendEmailDirect(email);
                } catch (error) {
                    console.error('❌ Failed to send queued email:', error);
                    // Optionally re-queue with retry limit
                    if (email.retries < 3) {
                        email.retries = (email.retries || 0) + 1;
                        this.emailQueue.push(email);
                    }
                }
                
                this.processing = false;
            }
        }, 5000); // Process queue every 5 seconds
    }
    
    // Add email to queue
    queueEmail(emailData) {
        this.emailQueue.push({
            ...emailData,
            queuedAt: new Date(),
            retries: 0
        });
    }
    
    // Direct send (immediate)
    async sendEmailDirect(emailData) {
        if (!this.initialized) {
            console.log('⚠️ Email service not initialized, skipping email');
            return false;
        }
        
        try {
            if (this.useSendGrid) {
                // SendGrid
                await this.transporter.send(emailData);
            } else {
                // Nodemailer
                await this.transporter.sendMail(emailData);
            }
            
            console.log(`✅ Email sent to ${emailData.to}`);
            return true;
            
        } catch (error) {
            console.error('❌ Email send error:', error);
            throw error;
        }
    }
    
    // Get current NFL week
    getCurrentWeek() {
        const now = new Date();
        const preseasonStart = new Date('2025-08-08');
        const regularSeasonStart = new Date('2025-09-04');
        
        if (now < preseasonStart) {
            return 'Pre-Season';
        } else if (now < regularSeasonStart) {
            const daysSinceStart = Math.floor((now - preseasonStart) / (24 * 60 * 60 * 1000));
            const preseasonWeek = Math.floor(daysSinceStart / 7) + 1;
            return `P${Math.min(4, Math.max(1, preseasonWeek))}`;
        } else {
            const weeksDiff = Math.ceil((now - regularSeasonStart) / (7 * 24 * 60 * 60 * 1000));
            return Math.max(1, Math.min(18, weeksDiff));
        }
    }
    
    // ==========================================
    // MAIN WELCOME EMAIL WITH DARK THEME
    // ==========================================
    
    async sendWelcomeEmail(user) {
        // Use template file if available, otherwise use inline template
        let emailHTML = this.templates['welcome-email-template'] || this.getWelcomeEmailTemplate();
        
        // Replace placeholders
        emailHTML = emailHTML
            .replace(/{{USERNAME}}/g, user.username)
            .replace(/{{DISPLAY_NAME}}/g, user.displayName || user.username)
            .replace(/{{CURRENT_WEEK}}/g, this.getCurrentWeek())
            .replace(/{{APP_URL}}/g, process.env.APP_URL || 'http://localhost:4040');
        
        const emailData = {
            from: process.env.EMAIL_FROM || 'noreply@calculated-degeneracy.com',
            to: user.email,
            subject: '🎰 Welcome to Calculated Degeneracy - Everything You Need to Know!',
            html: emailHTML
        };
        
        this.queueEmail(emailData);
        
        // Also notify admin if configured
        if (process.env.NOTIFY_NEW_REGISTRATIONS === 'true') {
            await this.sendAdminNewUserNotification(user);
        }
    }
    
    // Inline welcome template (fallback if file doesn't exist)
    getWelcomeEmailTemplate() {
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: Arial, Helvetica, sans-serif !important;
            margin: 0;
            padding: 0;
            background: #f5f5f5 !important;
        }
        
        .email-wrapper {
            max-width: 700px;
            margin: 0 auto;
            background: #ffffff !important;
        }
        
        .main-header {
            background: #1a1a2e !important;
            padding: 40px 30px;
            text-align: center;
            border-bottom: 4px solid #16b981;
        }
        
        .logo {
            font-size: 32px;
            font-weight: bold;
            color: #ffffff !important;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin: 0 0 10px 0;
        }
        
        .tagline {
            color: #fbbf24 !important;
            font-size: 16px;
            font-weight: 600;
        }
        
        .degen-stats-bar {
            background: #f8f9fa !important;
            border-radius: 10px;
            padding: 20px;
            margin: 20px;
            text-align: center;
        }
        
        .degen-stat {
            display: inline-block;
            padding: 15px 20px;
            background: #ffffff !important;
            border: 2px solid #e5e7eb;
            border-radius: 8px;
            margin: 5px;
            text-align: center;
        }
        
        .degen-stat-label {
            font-size: 12px;
            color: #6b7280 !important;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 600;
        }
        
        .degen-stat-value {
            font-size: 22px;
            font-weight: bold;
            color: #16b981 !important;
            margin-top: 5px;
        }
        
        .content-section {
            background: #ffffff !important;
            margin: 20px;
            border-radius: 12px;
            padding: 30px;
            border: 2px solid #e5e7eb;
            color: #1f2937 !important;
        }
        
        .section-title {
            font-size: 24px;
            font-weight: bold;
            color: #16b981 !important;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid #e5e7eb;
        }
        
        .prize-card {
            background: linear-gradient(135deg, #dc2626, #b91c1c) !important;
            color: #ffffff !important;
            padding: 25px;
            border-radius: 12px;
            text-align: center;
            margin: 10px;
            display: inline-block;
            width: calc(50% - 40px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        
        .prize-amount {
            font-size: 32px;
            font-weight: bold;
            color: #ffffff !important;
            margin: 10px 0;
        }
        
        .prize-label {
            font-size: 14px;
            color: #ffffff !important;
            opacity: 0.95;
        }
        
        .ai-feature-card {
            background: #f3f4f6 !important;
            border: 2px solid #9333ea;
            border-radius: 12px;
            padding: 20px;
            margin: 15px 0;
        }
        
        .bulk-discount-box {
            background: #ecfdf5 !important;
            border: 3px solid #10b981;
            border-radius: 12px;
            padding: 25px;
            margin: 20px 0;
            text-align: center;
        }
        
        .bulk-title {
            color: #059669 !important;
            font-size: 20px;
            font-weight: bold;
            margin-bottom: 15px;
        }
        
        .discount-text {
            color: #1f2937 !important;
            font-size: 16px;
            margin: 10px 0;
        }
        
        .discount-amount {
            color: #dc2626 !important;
            font-weight: bold;
        }
        
        .rule-box {
            background: #f9fafb !important;
            border-left: 4px solid #fbbf24;
            padding: 20px;
            margin: 15px 0;
            border-radius: 8px;
        }
        
        .rule-title {
            color: #92400e !important;
            font-weight: bold;
            font-size: 16px;
            margin-bottom: 10px;
        }
        
        .cta-button {
            display: inline-block;
            background: #10b981 !important;
            color: #ffffff !important;
            padding: 18px 36px;
            border-radius: 8px;
            text-decoration: none;
            font-weight: bold;
            font-size: 16px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .footer {
            background: #1f2937 !important;
            padding: 30px;
            text-align: center;
            color: #9ca3af !important;
            font-size: 14px;
        }
        
        .footer a {
            color: #10b981 !important;
            text-decoration: none;
        }
        
        ul {
            margin: 10px 0;
            padding-left: 25px;
        }
        
        li {
            color: #374151 !important;
            margin: 10px 0;
            line-height: 1.6;
            font-size: 15px;
        }
        
        p {
            color: #374151 !important;
            line-height: 1.6;
            font-size: 15px;
        }
        
        strong {
            color: #111827 !important;
            font-weight: bold;
        }
        
        @media (max-width: 600px) {
            .prize-card {
                width: calc(100% - 20px);
                display: block;
            }
            
            .degen-stat {
                display: block;
                width: calc(100% - 20px);
                margin: 5px auto;
            }
        }
    </style>
</head>
<body>
    <div class="email-wrapper">
        <div class="main-header">
            <h1 class="logo">🎰 CALCULATED DEGENERACY 🎲</h1>
            <div class="tagline">Where Math Meets Madness • AI-Powered Poor Decisions</div>
        </div>
        
        <div class="degen-stats-bar">
            <div class="degen-stat">
                <div class="degen-stat-label">Welcome Bonus</div>
                <div class="degen-stat-value">100 🪙</div>
            </div>
            <div class="degen-stat">
                <div class="degen-stat-label">Your Status</div>
                <div class="degen-stat-value">FRESH DEGEN</div>
            </div>
            <div class="degen-stat">
                <div class="degen-stat-label">Season Week</div>
                <div class="degen-stat-value">{{CURRENT_WEEK}}</div>
            </div>
        </div>
        
        <div class="content-section">
            <div class="section-title">🎉 Welcome {{DISPLAY_NAME}}!</div>
            <p>
                <strong>Username:</strong> @{{USERNAME}}<br>
                You've joined the most sophisticated NFL spread betting league powered by AI analysis.
            </p>
        </div>
        
        <div class="content-section">
            <div class="section-title">💰 Real Money Prizes</div>
            <div style="text-align: center;">
                <div class="prize-card">
                    <div class="prize-label">WEEKLY POT</div>
                    <div class="prize-amount">$500-700</div>
                    <div class="prize-label">Best Record Each Week</div>
                </div>
                <div class="prize-card">
                    <div class="prize-label">SEASON CHAMPIONSHIP</div>
                    <div class="prize-amount">$5,000-7,000</div>
                    <div class="prize-label">Best Overall Record</div>
                </div>
            </div>
            
            <div class="rule-box" style="margin-top: 20px;">
                <div class="rule-title">💵 Your Investment</div>
                <ul>
                    <li>$100/week for 18 weeks = $1,800</li>
                    <li>$1,000 season championship pot</li>
                    <li><strong>Total: $2,800</strong></li>
                </ul>
            </div>
        </div>
        
        <div class="content-section">
            <div class="section-title">🧠 AI-Powered Analysis</div>
            
            <div class="bulk-discount-box">
                <div class="bulk-title">🚀 MULTI-GAME BULK DISCOUNTS!</div>
                <p class="discount-text">Analyze multiple games at once and save BIG on DegenCoins!</p>
                <div class="discount-text">3+ Games: <span class="discount-amount">20% OFF</span></div>
                <div class="discount-text">5+ Games: <span class="discount-amount">30% OFF</span></div>
                <div class="discount-text">10+ Games: <span class="discount-amount">40% OFF</span></div>
            </div>
            
            <div class="ai-feature-card">
                <p style="font-weight: bold; color: #7c3aed !important; font-size: 16px; margin-bottom: 15px;">Available AI Features:</p>
                <ul>
                    <li><strong>🆓 Basic Analysis</strong> - FREE</li>
                    <li><strong>📈 Market Sentiment</strong> - 5 coins (3 coins bulk)</li>
                    <li><strong>📊 True Spread Calculator</strong> - 10 coins (6 coins bulk)</li>
                    <li><strong>🔄 Regression Predictor</strong> - 8 coins (5 coins bulk)</li>
                    <li><strong>🎮 Matchup Matrix</strong> - 15 coins (9 coins bulk)</li>
                    <li><strong>🌡️ Situational Analysis</strong> - 8 coins (5 coins bulk)</li>
                </ul>
            </div>
        </div>
        
        <div class="content-section">
            <div class="section-title">🎯 How It Works</div>
            
            <div class="rule-box">
                <div class="rule-title">Pick Requirements</div>
                <ul>
                    <li>Select <strong>4-6 games</strong> against the spread each week</li>
                    <li>Edit until <strong>15 minutes before YOUR first game</strong></li>
                    <li>Lines lock when YOU submit</li>
                    <li>All picks count for weekly AND season standings</li>
                </ul>
            </div>
            
            <div class="rule-box">
                <div class="rule-title">Weekly Timeline</div>
                <ul>
                    <li><strong>Wednesday:</strong> Lines posted, Claude analyzes</li>
                    <li><strong>Thursday 7pm ET:</strong> Soft deadline</li>
                    <li><strong>Sunday Night:</strong> Weekly winner announced</li>
                    <li><strong>Tuesday Noon:</strong> Payment deadline ($25 late fee)</li>
                </ul>
            </div>
            
            <div class="rule-box">
                <div class="rule-title">Scoring System</div>
                <ul>
                    <li>✅ <strong>Win</strong> = 1 point</li>
                    <li>❌ <strong>Loss</strong> = 0 points</li>
                    <li>➖ <strong>Push</strong> = 0.5 points</li>
                    <li>Best weekly record wins pot</li>
                    <li>Best season win % takes championship</li>
                </ul>
            </div>
        </div>
        
        <div class="content-section">
            <div class="section-title">💎 DegenCoin Packages</div>
            <p>You start with <strong>100 FREE coins</strong>. Need more? Here's what we offer:</p>
            
            <div style="background: #f9fafb; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <p><strong>Starter Pack:</strong> $4.99 = 550 coins</p>
                <p><strong>Popular Choice:</strong> $9.99 = 1,400 coins 🔥</p>
                <p><strong>Value Pack:</strong> $19.99 = 3,000 coins</p>
                <p><strong>Premium Pack:</strong> $39.99 = 7,000 coins</p>
                <p><strong>Whale Pack:</strong> $79.99 = 16,000 coins</p>
            </div>
        </div>
        
        <div style="text-align: center; margin: 40px 20px;">
            <a href="{{APP_URL}}" class="cta-button">
                🎲 MAKE YOUR WEEK {{CURRENT_WEEK}} PICKS NOW
            </a>
            <p style="margin-top: 20px; color: #6b7280 !important;">
                Lines are posted. Claude has analyzed everything. Your competition is already picking.
            </p>
        </div>
        
        <div class="footer">
            <p>© 2025 Calculated Degeneracy - Where Math Meets Madness</p>
            <p style="margin-top: 10px;">
                <a href="{{APP_URL}}/login">Login</a> | 
                <a href="{{APP_URL}}/leaderboard">Leaderboard</a> | 
                <a href="{{APP_URL}}/ai-features">AI Features</a>
            </p>
            <p style="margin-top: 20px; font-size: 12px; color: #6b7280 !important;">
                This email was sent because someone registered with your email address.<br>
                If this wasn't you, please ignore this email.
            </p>
        </div>
    </div>
</body>
</html>`;
    }
    
    // ==========================================
    // OTHER EMAIL TEMPLATES
    // ==========================================
    
    // Admin notification for new registration
    async sendAdminNewUserNotification(user) {
        if (!process.env.ADMIN_EMAIL) return;
        
        const content = `
            <h2>🆕 New Degenerate Has Joined!</h2>
            
            <div class="success">
                <strong>Registration Details:</strong><br>
                Username: <strong>${user.username}</strong><br>
                Display Name: ${user.displayName}<br>
                Email: ${user.email}<br>
                Registered: ${new Date().toLocaleString()}<br>
                IP Address: ${user.lastLoginIP || 'Unknown'}
            </div>
            
            <p>Total registered users can be viewed in the admin dashboard.</p>
        `;
        
        const emailData = {
            from: process.env.EMAIL_FROM || 'noreply@calculated-degeneracy.com',
            to: process.env.ADMIN_EMAIL,
            subject: `🆕 New User Registration: ${user.username}`,
            html: this.getBaseTemplate(content, 'Admin')
        };
        
        await this.sendEmailDirect(emailData);
    }
    
    // Pick confirmation email
    async sendPickConfirmation(user, picks, week) {
        const gamesList = picks.selectedGames.map(game => {
            const pick = picks.picks.get(game.gameId);
            return `
                <div class="game-card">
                    <strong>${game.awayTeam} @ ${game.homeTeam}</strong><br>
                    Your Pick: <strong>${pick.team}</strong><br>
                    Spread: ${game.currentSpread} | Total: ${game.currentTotal}<br>
                    Claude Confidence: ${pick.claudeAnalysisAtPick?.confidence || 'N/A'}%
                </div>
            `;
        }).join('');
        
        const content = `
            <h2>Picks Confirmed for Week ${week}! 🎲</h2>
            <p>Your degenerate selections have been locked in.</p>
            
            <div class="success">
                <strong>📊 Summary:</strong><br>
                Games Selected: ${picks.selectedGames.length}<br>
                Average Confidence: ${picks.claudeAnalysis.averageConfidence.toFixed(1)}%<br>
                Quality Score: ${picks.claudeAnalysis.qualityScore.toFixed(1)}/10
            </div>
            
            <h3>Your Picks:</h3>
            ${gamesList}
            
            <center>
                <a href="${process.env.APP_URL || 'http://localhost:4040'}" class="button">
                    View Dashboard →
                </a>
            </center>
            
            <p><em>May the odds be ever in your favor (they won't be).</em></p>
        `;
        
        const emailData = {
            from: process.env.EMAIL_FROM || 'noreply@calculated-degeneracy.com',
            to: user.email,
            subject: `🎯 Week ${week} Picks Confirmed!`,
            html: this.getBaseTemplate(content, user.displayName)
        };
        
        this.queueEmail(emailData);
    }
    
    // Line movement alert
    async sendLineMovementAlert(user, game, movement) {
        const content = `
            <h2>⚠️ Significant Line Movement Alert!</h2>
            
            <div class="alert">
                <strong>${game.awayTeam} @ ${game.homeTeam}</strong><br>
                Original Line: ${movement.originalSpread}<br>
                Current Line: ${movement.currentSpread}<br>
                Movement: ${movement.change} points ${movement.direction}<br>
                <br>
                <strong>Impact on Your Pick:</strong> ${movement.impact}
            </div>
            
            <p>This ${movement.favorable ? 'improves' : 'worsens'} your position.</p>
            
            <center>
                <a href="${process.env.APP_URL || 'http://localhost:4040'}/line-analysis" class="button">
                    View Line Analysis →
                </a>
            </center>
        `;
        
        const emailData = {
            from: process.env.EMAIL_FROM || 'noreply@calculated-degeneracy.com',
            to: user.email,
            subject: `📈 Line Movement: ${game.awayTeam} @ ${game.homeTeam}`,
            html: this.getBaseTemplate(content, user.displayName)
        };
        
        this.queueEmail(emailData);
    }
    
    // Weekly results email
    async sendWeeklyResults(user, results) {
        const resultsList = results.games.map(game => `
            <div class="game-card">
                <strong>${game.awayTeam} @ ${game.homeTeam}</strong><br>
                Final: ${game.finalScore.away} - ${game.finalScore.home}<br>
                Your Pick: ${game.userPick} - <strong>${game.result}</strong>
            </div>
        `).join('');
        
        const content = `
            <h2>Week ${results.week} Results 📊</h2>
            
            <div class="${results.winRate >= 60 ? 'success' : 'alert'}">
                <strong>Your Record: ${results.record}</strong><br>
                Win Rate: ${results.winRate}%<br>
                Season Record: ${results.seasonRecord}<br>
                Current Rank: #${results.rank}
            </div>
            
            <h3>Game Results:</h3>
            ${resultsList}
            
            <center>
                <a href="${process.env.APP_URL || 'http://localhost:4040'}/leaderboard" class="button">
                    View Leaderboard →
                </a>
            </center>
        `;
        
        const emailData = {
            from: process.env.EMAIL_FROM || 'noreply@calculated-degeneracy.com',
            to: user.email,
            subject: `📈 Week ${results.week} Results: ${results.record}`,
            html: this.getBaseTemplate(content, user.displayName)
        };
        
        this.queueEmail(emailData);
    }
    
    // Password reset email
    async sendPasswordReset(user, resetToken) {
        const resetUrl = `${process.env.APP_URL || 'http://localhost:4040'}/reset-password?token=${resetToken}`;
        
        const content = `
            <h2>Password Reset Request 🔐</h2>
            <p>Someone requested a password reset for your account.</p>
            
            <div class="alert">
                <strong>⚠️ If this wasn't you, ignore this email.</strong>
            </div>
            
            <p>To reset your password, click the button below:</p>
            
            <center>
                <a href="${resetUrl}" class="button">
                    Reset Password →
                </a>
            </center>
            
            <p><small>This link expires in 1 hour.</small></p>
        `;
        
        const emailData = {
            from: process.env.EMAIL_FROM || 'noreply@calculated-degeneracy.com',
            to: user.email,
            subject: '🔐 Password Reset Request',
            html: this.getBaseTemplate(content, user.displayName)
        };
        
        await this.sendEmailDirect(emailData); // Send immediately
    }

    // Daily bonus reminder
    async sendDailyBonusReminder(user) {
        const content = `
            <h2>💰 Daily Bonus Available!</h2>
            <p>Don't forget to claim your daily DegenCoins!</p>
            
            <div class="success">
                <strong>Current Streak: ${user.wallet?.dailyEarnings?.streak || 0} days</strong><br>
                <p>Keep your streak alive for bigger bonuses!</p>
            </div>
            
            <center>
                <a href="${process.env.APP_URL || 'http://localhost:4040'}" class="button">
                    Claim Bonus →
                </a>
            </center>
            
            <p><em>The house always wins... but daily bonuses are free!</em></p>
        `;
        
        const emailData = {
            from: process.env.EMAIL_FROM || 'noreply@calculated-degeneracy.com',
            to: user.email,
            subject: '💰 Your Daily Bonus is Waiting!',
            html: this.getBaseTemplate(content, user.displayName)
        };
        
        this.queueEmail(emailData);
    }

    // Weekly picks reminder
    async sendWeeklyPickReminder(user, week) {
        const content = `
            <h2>⏰ Pick Deadline Approaching!</h2>
            <p>You haven't submitted your picks for Week ${week} yet.</p>
            
            <div class="alert">
                <strong>Deadline: Thursday Night</strong><br>
                Don't miss out on this week's action!
            </div>
            
            <center>
                <a href="${process.env.APP_URL || 'http://localhost:4040'}" class="button">
                    Make Your Picks →
                </a>
            </center>
            
            <p><em>Fortune favors the bold... but mostly the house.</em></p>
        `;
        
        const emailData = {
            from: process.env.EMAIL_FROM || 'noreply@calculated-degeneracy.com',
            to: user.email,
            subject: `⏰ Week ${week} Picks Due Soon!`,
            html: this.getBaseTemplate(content, user.displayName)
        };
        
        this.queueEmail(emailData);
    }
    
    // Admin notification for picks submission
    async sendAdminPicksNotification(user, picks, week) {
        if (!process.env.ADMIN_EMAIL || process.env.NOTIFY_PICKS_SUBMITTED !== 'true') {
            return;
        }
        
        const gamesList = picks.selectedGames.map(game => 
            `<li>${game.awayTeam} @ ${game.homeTeam}</li>`
        ).join('');
        
        const content = `
            <h2>📋 New Picks Submitted</h2>
            
            <div class="success">
                <strong>Submission Details:</strong><br>
                User: <strong>${user.username}</strong><br>
                Week: ${week}<br>
                Games Selected: ${picks.selectedGames.length}<br>
                Submitted: ${new Date().toLocaleString()}<br>
                Average Confidence: ${picks.claudeAnalysis.averageConfidence.toFixed(1)}%
            </div>
            
            <h3>Games Selected:</h3>
            <ul>${gamesList}</ul>
            
            <center>
                <a href="${process.env.APP_URL || 'http://localhost:4040'}/admin/dashboard" class="button">
                    View Admin Dashboard →
                </a>
            </center>
        `;
        
        const emailData = {
            from: process.env.EMAIL_FROM || 'noreply@calculated-degeneracy.com',
            to: process.env.ADMIN_EMAIL,
            subject: `📋 Picks Submitted: ${user.username} - Week ${week}`,
            html: this.getBaseTemplate(content, 'Admin')
        };
        
        this.queueEmail(emailData);
    }
    
    // Admin error notification
    async sendAdminErrorNotification(error, context) {
        if (!process.env.ADMIN_EMAIL || process.env.NOTIFY_SYSTEM_ERRORS !== 'true') {
            return;
        }
        
        const content = `
            <h2>⚠️ System Error Alert</h2>
            
            <div class="alert">
                <strong>Error Details:</strong><br>
                Message: ${error.message}<br>
                Context: ${context}<br>
                Time: ${new Date().toLocaleString()}<br>
                Environment: ${process.env.NODE_ENV}
            </div>
            
            <h3>Stack Trace:</h3>
            <pre style="background: #f5f5f5; padding: 10px; border-radius: 5px; font-size: 12px;">
${error.stack || 'No stack trace available'}
            </pre>
            
            <center>
                <a href="${process.env.APP_URL || 'http://localhost:4040'}/admin/settings" class="button">
                    View System Settings →
                </a>
            </center>
        `;
        
        const emailData = {
            from: process.env.EMAIL_FROM || 'noreply@calculated-degeneracy.com',
            to: process.env.ADMIN_EMAIL,
            subject: `⚠️ System Error: ${error.message.substring(0, 50)}`,
            html: this.getBaseTemplate(content, 'Admin')
        };
        
        await this.sendEmailDirect(emailData);
    }
    
    // Daily admin report
    async sendDailyAdminReport(stats) {
        if (!process.env.ADMIN_EMAIL || process.env.NOTIFY_DAILY_REPORTS !== 'true') {
            return;
        }
        
        const content = `
            <h2>📊 Daily System Report</h2>
            <p>Date: ${new Date().toLocaleDateString()}</p>
            
            <div class="success">
                <strong>Today's Activity:</strong><br>
                New Users: ${stats.newUsers || 0}<br>
                Picks Submitted: ${stats.picksSubmitted || 0}<br>
                Total Logins: ${stats.totalLogins || 0}<br>
                Active Users: ${stats.activeUsers || 0}<br>
                Revenue: $${stats.revenue || 0}
            </div>
            
            <h3>System Health:</h3>
            <ul>
                <li>Database Status: ${stats.dbStatus || 'Healthy'}</li>
                <li>Email Queue: ${stats.emailQueue || 0} pending</li>
                <li>API Calls Made: ${stats.apiCalls || 0}</li>
                <li>Errors Today: ${stats.errors || 0}</li>
            </ul>
            
            <h3>Week ${stats.currentWeek} Status:</h3>
            <ul>
                <li>Total Picks: ${stats.weeklyPicks || 0}</li>
                <li>Users Participated: ${stats.weeklyUsers || 0}</li>
                <li>Games Scored: ${stats.gamesScored || 0}</li>
            </ul>
            
            <center>
                <a href="${process.env.APP_URL || 'http://localhost:4040'}/admin/dashboard" class="button">
                    View Full Dashboard →
                </a>
            </center>
        `;
        
        const emailData = {
            from: process.env.EMAIL_FROM || 'noreply@calculated-degeneracy.com',
            to: process.env.ADMIN_EMAIL,
            subject: `📊 Daily Report - ${new Date().toLocaleDateString()}`,
            html: this.getBaseTemplate(content, 'Admin')
        };
        
        this.queueEmail(emailData);
    }
    
    // Game start reminder
    async sendGameStartReminder(user, games) {
        const gamesList = games.map(game => `
            <li>${game.awayTeam} @ ${game.homeTeam} - ${new Date(game.gameTime).toLocaleTimeString()}</li>
        `).join('');
        
        const content = `
            <h2>🏈 Games Starting Soon!</h2>
            <p>Your picks are about to go live. Time to start sweating!</p>
            
            <div class="alert">
                <strong>Games Starting in Next Hour:</strong>
                <ul>${gamesList}</ul>
            </div>
            
            <center>
                <a href="${process.env.APP_URL || 'http://localhost:4040'}" class="button">
                    Watch Live Scores →
                </a>
            </center>
            
            <p><em>Remember: It's not about the money, it's about the dopamine.</em></p>
        `;
        
        const emailData = {
            from: process.env.EMAIL_FROM || 'noreply@calculated-degeneracy.com',
            to: user.email,
            subject: '⏰ Your Games Starting Soon!',
            html: this.getBaseTemplate(content, user.displayName)
        };
        
        this.queueEmail(emailData);
    }
    
    // Base template for simple emails
    getBaseTemplate(content, userName = 'Degenerate') {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                        line-height: 1.6;
                        color: #333;
                        max-width: 600px;
                        margin: 0 auto;
                        padding: 20px;
                        background: #f5f5f5;
                    }
                    .container {
                        background: white;
                        border-radius: 10px;
                        padding: 30px;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    }
                    .header {
                        text-align: center;
                        border-bottom: 3px solid #10b981;
                        padding-bottom: 20px;
                        margin-bottom: 30px;
                    }
                    .header h1 {
                        color: #10b981;
                        font-size: 28px;
                        margin: 0;
                    }
                    .content {
                        margin: 20px 0;
                    }
                    .button {
                        display: inline-block;
                        padding: 12px 30px;
                        background: linear-gradient(135deg, #10b981, #059669);
                        color: white;
                        text-decoration: none;
                        border-radius: 5px;
                        font-weight: bold;
                        margin: 20px 0;
                    }
                    .footer {
                        text-align: center;
                        margin-top: 30px;
                        padding-top: 20px;
                        border-top: 1px solid #e5e5e5;
                        color: #666;
                        font-size: 12px;
                    }
                    .game-card {
                        background: #f8f8f8;
                        border-left: 4px solid #10b981;
                        padding: 15px;
                        margin: 10px 0;
                        border-radius: 5px;
                    }
                    .alert {
                        background: #fef2f2;
                        border-left: 4px solid #ef4444;
                        padding: 15px;
                        margin: 20px 0;
                        border-radius: 5px;
                    }
                    .success {
                        background: #f0fdf4;
                        border-left: 4px solid #10b981;
                        padding: 15px;
                        margin: 20px 0;
                        border-radius: 5px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>🎰 CALCULATED DEGENERACY 🎲</h1>
                        <div style="color: #666; font-size: 14px;">Where Math Meets Madness</div>
                    </div>
                    <div class="content">
                        ${content}
                    </div>
                    <div class="footer">
                        <p>© 2025 Calculated Degeneracy</p>
                        <p>
                            <a href="${process.env.APP_URL || 'http://localhost:4040'}/unsubscribe">Unsubscribe</a> | 
                            <a href="${process.env.APP_URL || 'http://localhost:4040'}/preferences">Email Preferences</a>
                        </p>
                    </div>
                </div>
            </body>
            </html>
        `;
    }
    
    // Get queue status
    getQueueStatus() {
        return {
            queueLength: this.emailQueue.length,
            processing: this.processing,
            initialized: this.initialized,
            service: process.env.EMAIL_SERVICE || 'not configured'
        };
    }
    
    // Clear queue
    clearQueue() {
        const count = this.emailQueue.length;
        this.emailQueue = [];
        return count;
    }
    
    // Shutdown service
    shutdown() {
        this.initialized = false;
        this.clearQueue();
        console.log('📧 Email service shut down');
    }
}

module.exports = EmailNotificationService;