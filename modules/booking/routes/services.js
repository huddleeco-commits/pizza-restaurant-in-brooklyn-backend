const express = require('express');
const router = express.Router();

// In-memory storage (replace with database in production)
let services = [
    // Primary Care
    {
        id: 'annual-physical',
        name: 'Annual Physical Exams',
        description: 'Comprehensive health assessments including preventive screenings and health risk evaluations',
        category: 'primary-care',
        categoryName: 'Primary Care',
        duration: 60,
        price: 250,
        badges: ['available'],
        popularity: 'high',
        metadata: {
            icon: '⏱️',
            insuranceCovered: true,
            bookingType: 'advance',
            providers: 5
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'preventive-care',
        name: 'Preventive Care',
        description: 'Immunizations, health screenings, and lifestyle counseling to maintain optimal health',
        category: 'primary-care',
        categoryName: 'Primary Care',
        duration: 30,
        price: 150,
        badges: ['walk-in'],
        popularity: 'high',
        metadata: {
            icon: '✅',
            walkInsWelcome: true,
            bookingType: 'same-day'
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'chronic-disease',
        name: 'Chronic Disease Management',
        description: 'Ongoing care for diabetes, hypertension, asthma, and other chronic conditions',
        category: 'primary-care',
        categoryName: 'Primary Care',
        duration: 45,
        price: 200,
        badges: ['team'],
        popularity: 'medium',
        metadata: {
            icon: '👥',
            teamCare: true,
            recurring: true
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'sick-visits',
        name: 'Sick Visits',
        description: 'Same-day appointments for acute illnesses like cold, flu, infections, and minor injuries',
        category: 'primary-care',
        categoryName: 'Primary Care',
        duration: 25,
        price: 180,
        badges: ['urgent'],
        popularity: 'high',
        metadata: {
            icon: '🚨',
            sameDayAvailable: true,
            bookingType: 'urgent'
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },

    // Specialty Care
    {
        id: 'cardiology',
        name: 'Cardiology',
        description: 'Heart health evaluations, EKG, stress tests, and management of cardiovascular conditions',
        category: 'specialty-care',
        categoryName: 'Specialty Care',
        duration: 60,
        price: 350,
        badges: ['available'],
        popularity: 'high',
        featured: true,
        metadata: {
            icon: '👨‍⚕️',
            specialists: 5,
            boardCertified: true,
            equipment: ['EKG', 'Stress Test', 'Echocardiogram']
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'orthopedics',
        name: 'Orthopedics',
        description: 'Treatment for bone, joint, and muscle conditions including sports injuries and arthritis',
        category: 'specialty-care',
        categoryName: 'Specialty Care',
        duration: 45,
        price: 300,
        badges: ['equipment'],
        popularity: 'high',
        metadata: {
            icon: '🔧',
            onSiteXray: true,
            imagingAvailable: true
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'dermatology',
        name: 'Dermatology',
        description: 'Skin cancer screenings, acne treatment, and management of skin conditions',
        category: 'specialty-care',
        categoryName: 'Specialty Care',
        duration: 30,
        price: 250,
        badges: ['available'],
        popularity: 'medium',
        metadata: {
            icon: '📅',
            bookingAdvance: '2 weeks'
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'gastro',
        name: 'Gastroenterology',
        description: 'Digestive health services including colonoscopy, endoscopy, and IBS management',
        category: 'specialty-care',
        categoryName: 'Specialty Care',
        duration: 60,
        price: 400,
        badges: ['prep'],
        popularity: 'medium',
        metadata: {
            icon: '📋',
            prepRequired: true,
            procedures: ['Colonoscopy', 'Endoscopy']
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },

    // Diagnostic Services
    {
        id: 'lab-services',
        name: 'Laboratory Services',
        description: 'Complete blood work, urinalysis, and specialized testing with fast results',
        category: 'diagnostics',
        categoryName: 'Diagnostic Services',
        duration: 15,
        price: 100,
        badges: ['fast'],
        popularity: 'high',
        metadata: {
            icon: '📊',
            resultsTime: '24-48 hours',
            walkIn: true
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'imaging',
        name: 'Medical Imaging',
        description: 'X-rays, CT scans, MRI, and ultrasound services with expert radiologist interpretation',
        category: 'diagnostics',
        categoryName: 'Diagnostic Services',
        duration: 60,
        price: 500,
        badges: ['tech'],
        popularity: 'high',
        metadata: {
            icon: '🖥️',
            digitalImaging: true,
            modalitiesAvailable: ['X-ray', 'CT', 'MRI', 'Ultrasound']
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'cardiac-testing',
        name: 'Cardiac Testing',
        description: 'EKG, echocardiogram, stress tests, and Holter monitoring for heart health',
        category: 'diagnostics',
        categoryName: 'Diagnostic Services',
        duration: 90,
        price: 450,
        badges: ['specialist'],
        popularity: 'medium',
        metadata: {
            icon: '❤️',
            cardiologistReview: true,
            tests: ['EKG', 'Echo', 'Stress Test', 'Holter']
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'pulmonary',
        name: 'Pulmonary Function Tests',
        description: 'Lung capacity testing, spirometry, and respiratory health assessments',
        category: 'diagnostics',
        categoryName: 'Diagnostic Services',
        duration: 30,
        price: 200,
        badges: ['no-prep'],
        popularity: 'low',
        metadata: {
            icon: '🚫',
            prepNeeded: false
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },

    // Women's Health
    {
        id: 'obgyn',
        name: 'OB/GYN Services',
        description: 'Annual exams, prenatal care, family planning, and reproductive health services',
        category: 'womens-health',
        categoryName: "Women's Health",
        duration: 45,
        price: 275,
        badges: ['provider'],
        popularity: 'high',
        metadata: {
            icon: '👩‍⚕️',
            femaleProvidersAvailable: true
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'mammography',
        name: 'Mammography',
        description: '3D mammography screening for early breast cancer detection',
        category: 'womens-health',
        categoryName: "Women's Health",
        duration: 30,
        price: 300,
        badges: ['tech'],
        popularity: 'high',
        metadata: {
            icon: '📅',
            technology: '3D',
            ageRecommendation: '40+'
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'bone-density',
        name: 'Bone Density Testing',
        description: 'DEXA scans for osteoporosis screening and bone health monitoring',
        category: 'womens-health',
        categoryName: "Women's Health",
        duration: 20,
        price: 250,
        badges: ['frequency'],
        popularity: 'medium',
        metadata: {
            icon: '📆',
            frequency: 'Every 2 years',
            technology: 'DEXA'
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'menopause',
        name: 'Menopause Management',
        description: 'Hormone therapy consultation and comprehensive menopause care',
        category: 'womens-health',
        categoryName: "Women's Health",
        duration: 45,
        price: 225,
        badges: ['approach'],
        popularity: 'medium',
        metadata: {
            icon: '🌿',
            holisticOptions: true,
            hormoneTherapy: true
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },

    // Pediatrics
    {
        id: 'well-child',
        name: 'Well-Child Visits',
        description: 'Regular checkups, growth monitoring, and developmental assessments from birth to 18',
        category: 'pediatrics',
        categoryName: 'Pediatrics',
        duration: 45,
        price: 200,
        badges: ['schedule'],
        popularity: 'high',
        metadata: {
            icon: '📅',
            ageBased: true,
            ageRange: '0-18'
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'immunizations',
        name: 'Immunizations',
        description: 'Complete vaccination services following CDC guidelines for children and adolescents',
        category: 'pediatrics',
        categoryName: 'Pediatrics',
        duration: 15,
        price: 50,
        badges: ['records'],
        popularity: 'high',
        metadata: {
            icon: '📋',
            cdcCompliant: true,
            digitalRecords: true
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'sports-physicals',
        name: 'School & Sports Physicals',
        description: 'Required physical exams for school enrollment and sports participation',
        category: 'pediatrics',
        categoryName: 'Pediatrics',
        duration: 30,
        price: 100,
        badges: ['timing'],
        popularity: 'high',
        metadata: {
            icon: '🎒',
            rushPeriod: 'August',
            sameDay: true
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'behavioral-health',
        name: 'Behavioral Health',
        description: 'ADHD evaluation, anxiety management, and developmental disorder screening',
        category: 'pediatrics',
        categoryName: 'Pediatrics',
        duration: 60,
        price: 350,
        badges: ['team'],
        popularity: 'medium',
        metadata: {
            icon: '🧠',
            childPsychologist: true,
            initialVisit: 60
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },

    // Urgent Care
    {
        id: 'walk-in-urgent',
        name: 'Walk-In Urgent Care',
        description: 'No appointment needed for non-life-threatening conditions requiring immediate attention',
        category: 'urgent-care',
        categoryName: 'Urgent Care',
        duration: 45,
        price: 200,
        badges: ['urgent'],
        popularity: 'high',
        metadata: {
            icon: '🕐',
            hours: 'Open until 10 PM',
            waitTime: 25,
            noAppointmentNeeded: true
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'minor-injury',
        name: 'Minor Injury Treatment',
        description: 'Cuts, burns, sprains, fractures, and minor trauma care with on-site X-ray',
        category: 'urgent-care',
        categoryName: 'Urgent Care',
        duration: 60,
        price: 250,
        badges: ['capability'],
        popularity: 'high',
        metadata: {
            icon: '🔧',
            services: ['Stitches', 'Casting', 'X-ray'],
            onSiteXray: true
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'acute-illness',
        name: 'Acute Illness Care',
        description: 'Treatment for flu, strep throat, UTIs, ear infections, and other sudden illnesses',
        category: 'urgent-care',
        categoryName: 'Urgent Care',
        duration: 30,
        price: 180,
        badges: ['testing'],
        popularity: 'high',
        metadata: {
            icon: '💊',
            rapidTesting: true,
            onSiteLab: true,
            pharmacyAvailable: true
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    }
];

// Service categories
const categories = [
    { id: 'primary-care', name: 'Primary Care', icon: '🩺', count: 4 },
    { id: 'specialty-care', name: 'Specialty Care', icon: '👨‍⚕️', count: 4 },
    { id: 'diagnostics', name: 'Diagnostic Services', icon: '🔬', count: 4 },
    { id: 'womens-health', name: "Women's Health", icon: '👩‍⚕️', count: 4 },
    { id: 'pediatrics', name: 'Pediatrics', icon: '👶', count: 4 },
    { id: 'urgent-care', name: 'Urgent Care', icon: '🚨', count: 3 }
];

// ===========================
// GET ALL SERVICES
// ===========================
router.get('/', (req, res) => {
    try {
        const { category, search, sort, popular } = req.query;

        let filteredServices = [...services];

        // Filter by category
        if (category && category !== 'all') {
            filteredServices = filteredServices.filter(s => s.category === category);
        }

        // Search filter
        if (search) {
            const searchLower = search.toLowerCase();
            filteredServices = filteredServices.filter(s =>
                s.name.toLowerCase().includes(searchLower) ||
                s.description.toLowerCase().includes(searchLower) ||
                s.category.toLowerCase().includes(searchLower)
            );
        }

        // Popular filter
        if (popular === 'true') {
            filteredServices = filteredServices.filter(s => s.popularity === 'high');
        }

        // Sort
        if (sort === 'name') {
            filteredServices.sort((a, b) => a.name.localeCompare(b.name));
        } else if (sort === 'price') {
            filteredServices.sort((a, b) => a.price - b.price);
        } else if (sort === 'duration') {
            filteredServices.sort((a, b) => a.duration - b.duration);
        } else if (sort === 'popular') {
            const popOrder = { high: 0, medium: 1, low: 2 };
            filteredServices.sort((a, b) => popOrder[a.popularity] - popOrder[b.popularity]);
        }

        res.json({
            success: true,
            count: filteredServices.length,
            data: filteredServices,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching services:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch services',
            message: error.message
        });
    }
});

// ===========================
// GET SERVICE BY ID
// ===========================
router.get('/:id', (req, res) => {
    try {
        const service = services.find(s => s.id === req.params.id);

        if (!service) {
            return res.status(404).json({
                success: false,
                error: 'Service not found',
                message: `No service found with ID: ${req.params.id}`
            });
        }

        res.json({
            success: true,
            data: service,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching service:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch service',
            message: error.message
        });
    }
});

// ===========================
// GET CATEGORIES
// ===========================
router.get('/meta/categories', (req, res) => {
    try {
        res.json({
            success: true,
            data: categories,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch categories',
            message: error.message
        });
    }
});

// ===========================
// GET FEATURED SERVICES
// ===========================
router.get('/meta/featured', (req, res) => {
    try {
        const featuredServices = services.filter(s => s.featured === true);

        res.json({
            success: true,
            count: featuredServices.length,
            data: featuredServices,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching featured services:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch featured services',
            message: error.message
        });
    }
});

// ===========================
// GET WAIT TIME (for urgent care)
// ===========================
router.get('/meta/wait-time', (req, res) => {
    try {
        // Simulate dynamic wait time
        const waitTime = Math.floor(Math.random() * 45) + 15;

        res.json({
            success: true,
            data: {
                waitTime: waitTime,
                unit: 'minutes',
                lastUpdated: new Date().toISOString()
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching wait time:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch wait time',
            message: error.message
        });
    }
});

// ===========================
// CREATE SERVICE (Admin)
// ===========================
router.post('/', (req, res) => {
    try {
        const newService = {
            id: req.body.id || `service-${Date.now()}`,
            name: req.body.name,
            description: req.body.description,
            category: req.body.category,
            categoryName: req.body.categoryName,
            duration: req.body.duration,
            price: req.body.price,
            badges: req.body.badges || [],
            popularity: req.body.popularity || 'medium',
            featured: req.body.featured || false,
            metadata: req.body.metadata || {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        services.push(newService);

        res.status(201).json({
            success: true,
            message: 'Service created successfully',
            data: newService,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error creating service:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create service',
            message: error.message
        });
    }
});

// ===========================
// UPDATE SERVICE (Admin)
// ===========================
router.put('/:id', (req, res) => {
    try {
        const index = services.findIndex(s => s.id === req.params.id);

        if (index === -1) {
            return res.status(404).json({
                success: false,
                error: 'Service not found',
                message: `No service found with ID: ${req.params.id}`
            });
        }

        services[index] = {
            ...services[index],
            ...req.body,
            id: req.params.id, // Prevent ID change
            updatedAt: new Date().toISOString()
        };

        res.json({
            success: true,
            message: 'Service updated successfully',
            data: services[index],
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error updating service:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update service',
            message: error.message
        });
    }
});

// ===========================
// DELETE SERVICE (Admin)
// ===========================
router.delete('/:id', (req, res) => {
    try {
        const index = services.findIndex(s => s.id === req.params.id);

        if (index === -1) {
            return res.status(404).json({
                success: false,
                error: 'Service not found',
                message: `No service found with ID: ${req.params.id}`
            });
        }

        const deletedService = services.splice(index, 1)[0];

        res.json({
            success: true,
            message: 'Service deleted successfully',
            data: deletedService,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error deleting service:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete service',
            message: error.message
        });
    }
});

module.exports = router;