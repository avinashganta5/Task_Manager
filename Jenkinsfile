pipeline {
    agent any

    stages {
        stage('Initialize') {
            steps {
                echo 'Preparing workspace...'
            }
        }
        stage('Execute Test') {
            steps {
                echo 'Running system checks...'
                // Simulating a random failure. Change to 'true' to simulate a success.
                sh 'pwd' 
            }
        }
    }

    // The post block sits at the same structural level as stages
    post {
        always {
            echo 'Cleaning up temporary logs and workspaces...'
        }
        success {
            echo 'Build passed! Deploying to environment...'
        }
        failure {
            echo 'WARNING: Build failed! Sending alert notification...'
        }
    }
}
