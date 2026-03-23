const { Client, GatewayIntentBits, PermissionFlagsBits, ChannelType, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();
require("dotenv").config();
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMembers,
    ]
});

const TICKET_CATEGORY_ID = '1481203208817741854';
const STAFF_ROLE_ID = '907496795356143666';
const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = "1415253003274948668";
const WEB_SERVER_PORT = process.env.WEB_SERVER_PORT || process.env.PORT || 3000;

let ticketCounter = 0;
const ticketUsers = new Map();
let onlineUsers = 0;
let visitorMessageId = null;

// Define slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Creates the ticket panel for users to open tickets')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    new SlashCommandBuilder()
        .setName('close')
        .setDescription('Closes the current ticket (Staff only)'),
    
    new SlashCommandBuilder()
        .setName('add')
        .setDescription('Add a user to the ticket')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('The user to add to the ticket')
                .setRequired(true)
        ),
    
    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Shows server statistics including online members'),
].map(command => command.toJSON());

// Register slash commands
const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();

// Update bot status function
async function updateStatus() {
    try {
        await client.user.setPresence({
            activities: [{ name: " Watching over DripNest | Community bot", type: 1 }],
            status: "idle"
        });
        console.log("Bot status updated");
    } catch (error) {
        console.error("Error updating bot status:", error);
    }
}

client.once('ready', () => {
    console.log(`Bot logged in as ${client.user.tag}!`);
    console.log('Website visitor tracking enabled!');
    console.log(`Web server will run on http://localhost:${WEB_SERVER_PORT}`);
    
    // Update status when bot is ready
    updateStatus();
});

// Handle slash commands
client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        
        // /setup-ticket command
        if (interaction.commandName === 'ticket') {
            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('Support Ticket System')
                .setDescription('Need help? Click the button below to create a support ticket.\n\nOur team will assist you as soon as possible.')
                .setFooter({ text: 'Click the button to open a ticket' });

            const button = new ButtonBuilder()
                .setCustomId('create_ticket')
                .setLabel('Create Ticket')
                .setStyle(ButtonStyle.Primary);

            const row = new ActionRowBuilder().addComponents(button);

            await interaction.reply({ embeds: [embed], components: [row] });
        }

        // /close command
        if (interaction.commandName === 'close') {
            const openMatch = interaction.channel.name.match(/^ticket-(\d+)$/);
            const closedMatch = interaction.channel.name.match(/^closed-(\d+)$/);
            
            if (!openMatch && !closedMatch) {
                return interaction.reply({ 
                    content: 'This command can only be used in ticket channels!', 
                    ephemeral: true 
                });
            }

            const ticketNum = openMatch ? openMatch[1] : closedMatch[1];
            const userId = ticketUsers.get(ticketNum);
            
            if (!userId) {
                return interaction.reply({ 
                    content: 'Could not find ticket owner!', 
                    ephemeral: true 
                });
            }
            
            const isTicketOwner = interaction.user.id === userId;
            const isStaff = interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) || 
                           interaction.member.roles.cache.has(STAFF_ROLE_ID);
            
            if (!isTicketOwner && !isStaff) {
                return interaction.reply({ 
                    content: 'Only the ticket creator or staff can close this ticket!', 
                    ephemeral: true 
                });
            }

            try {
                await interaction.channel.permissionOverwrites.edit(userId, {
                    ViewChannel: false,
                    SendMessages: false,
                    ReadMessageHistory: false,
                });

                await interaction.channel.setName(`closed-${ticketNum}`);
                
            } catch (error) {
                console.error('Error updating permissions:', error);
            }

            await interaction.reply({ content: 'Ticket closed! The channel has been hidden from the user. Staff can still view it.' });
        }

        // /add command
        if (interaction.commandName === 'add') {
            if (!interaction.channel.name.startsWith('Ticket-')) {
                return interaction.reply({ 
                    content: 'This command can only be used in ticket channels!', 
                    ephemeral: true 
                });
            }

            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) && 
                !interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
                return interaction.reply({ 
                    content: 'Only staff members can add users to tickets!', 
                    ephemeral: true 
                });
            }

            const userToAdd = interaction.options.getUser('user');

            try {
                await interaction.channel.permissionOverwrites.create(userToAdd, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true,
                });

                await interaction.reply({ 
                    content: `${userToAdd} has been added to the ticket!` 
                });
            } catch (error) {
                console.error('Error adding user:', error);
                await interaction.reply({ 
                    content: 'Failed to add user to the ticket.', 
                    ephemeral: true 
                });
            }
        }

        // /serverstats command
        if (interaction.commandName === 'stats') {
            const guild = interaction.guild;
            
            await guild.members.fetch();
            
            const totalMembers = guild.memberCount;
            const onlineMembers = guild.members.cache.filter(member => 
                member.presence?.status === 'online' || 
                member.presence?.status === 'idle' || 
                member.presence?.status === 'dnd'
            ).size;
            const offlineMembers = totalMembers - onlineMembers;
            
            const onlineStatus = guild.members.cache.filter(m => m.presence?.status === 'online').size;
            const idleStatus = guild.members.cache.filter(m => m.presence?.status === 'idle').size;
            const dndStatus = guild.members.cache.filter(m => m.presence?.status === 'dnd').size;
            
            const botCount = guild.members.cache.filter(member => member.user.bot).size;
            const humanCount = totalMembers - botCount;

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle(`${guild.name} | Server Statistics`)
                .setThumbnail(guild.iconURL({ dynamic: true }))
                .setDescription('**Current Server Overview**')
                .addFields(
                    { 
                        name: 'Total Members', 
                        value: `\`\`\`${totalMembers.toLocaleString()}\`\`\``, 
                        inline: true 
                    },
                    { 
                        name: 'Bots', 
                        value: `\`\`\`${botCount.toLocaleString()}\`\`\``, 
                        inline: true 
                    },
                    
                    { 
                        name: 'Server Created', 
                        value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>\n<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, 
                        inline: true 
                    },
                    { 
                        name: 'Server ID', 
                        value: `\`${guild.id}\``, 
                        inline: true 
                    }
                )
                .setFooter({ text: `Requested by ${interaction.user.tag}` })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        }
    }

    // Button Interactions
    if (interaction.isButton()) {
        
        // Create Ticket Button
        if (interaction.customId === 'create_ticket') {
            await interaction.deferReply({ ephemeral: true });

            const existingTicket = interaction.guild.channels.cache.find(
                ch => {
                    const match = ch.name.match(/^ticket-(\d+)$/);
                    if (match) {
                        const ticketNum = match[1];
                        return ticketUsers.get(ticketNum) === interaction.user.id;
                    }
                    return false;
                }
            );

            if (existingTicket) {
                return interaction.editReply({ content: 'You already have an open ticket!' });
            }

            ticketCounter++;
            const ticketNumber = ticketCounter;
            ticketUsers.set(ticketNumber.toString(), interaction.user.id);

            try {
                const ticketChannel = await interaction.guild.channels.create({
                    name: `id -${ticketNumber}`,
                    type: ChannelType.GuildText,
                    parent: TICKET_CATEGORY_ID,
                    topic: `Ticket #${ticketNumber} | User: ${interaction.user.tag} | ID: ${interaction.user.id}`,
                    permissionOverwrites: [
                        {
                            id: interaction.guild.id,
                            deny: [PermissionFlagsBits.ViewChannel],
                        },
                        {
                            id: interaction.user.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory,
                            ],
                        },
                        {
                            id: STAFF_ROLE_ID,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory,
                            ],
                        },
                    ],
                });

                const ticketEmbed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle(`Ticket #${ticketNumber}`)
                    .setDescription(`Welcome ${interaction.user}!\n\nPlease describe your issue, and our staff will assist you shortly.\n\n**Commands:**\n\`/close\` - Close this ticket\n\`/add @user\` - Add someone to the ticket`)
                    .addFields(
                        { name: 'Ticket Number', value: `#${ticketNumber}`, inline: true },
                        { name: 'Created By', value: `${interaction.user.tag}`, inline: true }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'Support Team' });

                const closeButton = new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Close Ticket')
                    .setStyle(ButtonStyle.Danger);

                const deleteButton = new ButtonBuilder()
                    .setCustomId('delete_ticket')
                    .setLabel('Delete Ticket')
                    .setStyle(ButtonStyle.Secondary);

                const row = new ActionRowBuilder().addComponents(closeButton, deleteButton);

                await ticketChannel.send({ embeds: [ticketEmbed], components: [row] });

                await interaction.editReply({ 
                    content: `Ticket created! Check ${ticketChannel}` 
                });

            } catch (error) {
                console.error('Error creating ticket:', error);
                await interaction.editReply({ 
                    content: 'There was an error creating your ticket. Please contact an administrator.' 
                });
            }
        }

        // Close Ticket Button
        if (interaction.customId === 'close_ticket') {
            const ticketMatch = interaction.channel.name.match(/^ticket-(\d+)$/);
            if (!ticketMatch) {
                return interaction.reply({ 
                    content: 'Invalid ticket channel format!', 
                    ephemeral: true 
                });
            }
            
            const ticketNum = ticketMatch[1];
            const userId = ticketUsers.get(ticketNum);
            
            if (!userId) {
                return interaction.reply({ 
                    content: 'Could not find ticket owner!', 
                    ephemeral: true 
                });
            }
            
            const isTicketOwner = interaction.user.id === userId;
            const isStaff = interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) || 
                           interaction.member.roles.cache.has(STAFF_ROLE_ID);
            
            if (!isTicketOwner && !isStaff) {
                return interaction.reply({ 
                    content: 'Only the ticket creator or staff can close this ticket!', 
                    ephemeral: true 
                });
            }

            try {
                await interaction.channel.permissionOverwrites.edit(userId, {
                    ViewChannel: false,
                    SendMessages: false,
                    ReadMessageHistory: false,
                });

                await interaction.channel.setName(`closed-${ticketNum}`);
                
            } catch (error) {
                console.error('Error updating permissions:', error);
            }

            await interaction.reply({ content: 'Ticket closed! The channel has been hidden from the user. Staff can still view it.' });
        }

        // Delete Ticket Button
        if (interaction.customId === 'delete_ticket') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) && 
                !interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
                return interaction.reply({ 
                    content: 'Only staff members can delete tickets!', 
                    ephemeral: true 
                });
            }

            await interaction.reply({ content: 'Deleting ticket immediately...' });

            setTimeout(async () => {
                try {
                    await interaction.channel.delete();
                } catch (error) {
                    console.error('Error deleting ticket:', error);
                }
            }, 2000);
        }
    }
});

client.login(BOT_TOKEN);

// ============================================
// WEBSITE VISITOR TRACKING SYSTEM
// ============================================

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

async function updateVisitorEmbed() {
    const embed = {
        title: 'Website Live Visitors',
        description: 'Real-time visitor count on our website',
        color: 0x5865F2,
        fields: [
            {
                name: 'Currently Online',
                value: `**${onlineUsers}** ${onlineUsers === 1 ? 'person' : 'people'}`,
                inline: true
            },
            {
                name: 'Status',
                value: onlineUsers > 0 ? 'Active' : 'No visitors',
                inline: true
            }
        ],
        timestamp: new Date().toISOString(),
        footer: {
            text: 'Live Website Stats'
        }
    };

    try {
        if (visitorMessageId && process.env.DISCORD_WEBHOOK_URL) {
            await axios.patch(`${process.env.DISCORD_WEBHOOK_URL}/messages/${visitorMessageId}`, {
                embeds: [embed]
            });
        } else if (process.env.DISCORD_WEBHOOK_URL) {
            const response = await axios.post(`${process.env.DISCORD_WEBHOOK_URL}?wait=true`, {
                embeds: [embed]
            });
            visitorMessageId = response.data.id;
        }
        console.log(`Visitor embed updated. Online users: ${onlineUsers}`);
    } catch (error) {
        console.error('Error updating visitor embed:', error.message);
        if (error.response?.status === 404) {
            visitorMessageId = null;
        }
    }
}

io.on('connection', (socket) => {
    onlineUsers++;
    console.log(`Website visitor connected. Online: ${onlineUsers}`);
    
    io.emit('userCount', onlineUsers);
    updateVisitorEmbed();
    
    socket.on('disconnect', () => {
        onlineUsers--;
        console.log(`Website visitor disconnected. Online: ${onlineUsers}`);
        
        io.emit('userCount', onlineUsers);
        updateVisitorEmbed();
    });
});

app.get('/api/visitors', (req, res) => {
    res.json({ onlineUsers });
});

server.listen(WEB_SERVER_PORT, () => {
    console.log(`Website server running on http://localhost:${WEB_SERVER_PORT}`);
    console.log('Discord visitor tracking active!');
});
